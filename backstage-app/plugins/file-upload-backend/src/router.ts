import { Config } from '@backstage/config';
import {
  HttpAuthService,
  LoggerService,
  UserInfoService,
} from '@backstage/backend-plugin-api';
import { InputError, NotAllowedError } from '@backstage/errors';
import {
  DefaultGithubCredentialsProvider,
  GithubCredentials,
  GithubCredentialsProvider,
  ScmIntegrations,
} from '@backstage/integration';
import express, { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import https from 'https';
import http from 'http';
import { Octokit } from '@octokit/rest';


/** Calculates the SHA-256 hash of a file using streams (memory-efficient for large files). */
function sha256ofFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash   = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk: Buffer) => hash.update(chunk));
    stream.on('end',  () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** Streams a local file to an HTTPS/HTTP endpoint via PUT (used for LFS object upload). */
function lfsHttpPut(url: string, headers: Record<string, string>, filePath: string, fileSize: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;
    const req    = lib.request(
      {
        hostname: parsed.hostname,
        port:     parsed.port || undefined,
        path:     parsed.pathname + parsed.search,
        method:   'PUT',
        headers:  { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(fileSize) },
      },
      res => {
        res.resume(); // consume and discard response body
        const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300;
        if (ok) resolve();
        else reject(new Error(`LFS PUT failed: HTTP ${res.statusCode}`));
      },
    );
    req.on('error', reject);
    fs.createReadStream(filePath).pipe(req);
  });
}

export interface RouterOptions {
  config: Config;
  logger: LoggerService;
  httpAuth: HttpAuthService;
  userInfo: UserInfoService;
}

/**
 * Creates the Express router for the file-upload plugin.
 *
 * POST /api/file-upload/upload
 *   - multipart/form-data field: "file"
 *   - Saves the binary to ~/data/uploads/<timestamp>-<originalname>
 *   - Pushes the file to GitHub via the Contents API
 */
// ── GitHub config helper ─────────────────────────────────────────────────────
interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  targetDir: string;
  credentialsProvider: GithubCredentialsProvider;
}

function normalizeConfiguredRepo(value: string, owner: string): string {
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_.-]+$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const parts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    const repo = parts[1]?.replace(/\.git$/, '');
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.hostname.toLowerCase() !== 'github.com' ||
      parts.length !== 2 ||
      parts[0].toLowerCase() !== owner.toLowerCase() ||
      !repo ||
      !/^[A-Za-z0-9_.-]+$/.test(repo)
    ) {
      throw new Error('invalid GitHub repository URL');
    }
    return repo;
  } catch {
    throw new Error(
      `Invalid repository reference "${value}"; use a repository name or https://github.com/${owner}/<repo>`,
    );
  }
}

function getGitHubConfig(config: Config): GitHubConfig {
  const integrations = ScmIntegrations.fromConfig(config);
  const owner     = config.getString('fileUpload.github.owner');
  const repo      = normalizeConfiguredRepo(config.getString('fileUpload.github.repo'), owner);
  const branch    = config.getOptionalString('fileUpload.github.branch') ?? 'main';
  const targetDir = config.getOptionalString('fileUpload.github.targetDir') ?? '';
  const credentialsProvider = DefaultGithubCredentialsProvider.fromIntegrations(integrations);
  return { owner, repo, branch, targetDir, credentialsProvider };
}

async function getGitHubCredentials(
  config: GitHubConfig,
  repo = config.repo,
): Promise<GithubCredentials> {
  const credentials = await config.credentialsProvider.getCredentials({
    url: `https://github.com/${config.owner}/${repo}`,
  });
  if (!credentials.token) {
    throw new Error(`No GitHub credentials available for ${config.owner}/${repo}`);
  }
  return credentials;
}

function getGitHubAuthHeaders(credentials: GithubCredentials): Record<string, string> {
  return credentials.headers ?? { Authorization: `Bearer ${credentials.token}` };
}

/** Returns true when the file should be pushed via Git LFS. */
function shouldUseLfs(config: Config, filename: string, fileSize: number): boolean {
  const thresholdMb = config.getOptionalNumber('fileUpload.lfs.sizeThresholdMb') ?? 100;
  const threshold   = thresholdMb * 1024 * 1024;
  if (fileSize > threshold) return true;

  const ext      = path.extname(filename).toLowerCase();
  const lfsExts  = config.getOptionalStringArray('fileUpload.lfs.extensions') ?? [];
  return lfsExts.map(e => e.toLowerCase()).includes(ext);
}

function normalizeRepoPath(value: string): string {
  const normalized = path.posix.normalize(value.replace(/\\/g, '/')).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.startsWith('/') || normalized.includes('/../')) {
    throw new Error('Repository path must stay within the repository root.');
  }
  return normalized;
}

function normalizeRepoDirectory(value: string): string {
  if (!value.trim()) return '';
  return normalizeRepoPath(value);
}

function getAllowedRepos(config: Config, fallback: string, owner: string): string[] {
  const value = config.getOptionalString('fileUpload.github.allowedRepos');
  return value
    ? value
        .split(',')
        .map(repo => repo.trim())
        .filter(Boolean)
        .map(repo => normalizeConfiguredRepo(repo, owner))
    : [fallback];
}

export async function createRouter(options: RouterOptions): Promise<Router> {
  const { config, logger, httpAuth, userInfo } = options;

  // ── Upload directory ──────────────────────────────────────────────────────
  const uploadDir = path.join(os.homedir(), 'data', 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  logger.info(`File upload directory: ${uploadDir}`);

  // ── Multer – disk storage ─────────────────────────────────────────────────
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safeName}`);
    },
  });

  const maxFileSizeMb = config.getOptionalNumber('fileUpload.maxFileSizeMb') ?? 500;
  const upload = multer({
    storage,
    limits: {
      fileSize: maxFileSizeMb * 1024 * 1024,
      files: 1,
      fields: 2,
    },
  });

  const router = Router();
  router.use(express.json());

  const allowedGroups = new Set(
    config.getOptionalStringArray('fileUpload.allowedGroups') ?? [
      'group:default/platform-admin',
      'group:default/artifact-publisher',
    ],
  );

  const requirePublisher = async (req: Request, _res: Response, next: express.NextFunction) => {
    try {
      const credentials = await httpAuth.credentials(req);
      const info = await userInfo.getUserInfo(credentials);
      if (!info.ownershipEntityRefs.some(ref => allowedGroups.has(ref))) {
        throw new NotAllowedError('User is not allowed to manage artifacts.');
      }
      next();
    } catch (error) {
      next(error);
    }
  };

  const getAllowedRepo = (value: unknown, cfg: GitHubConfig): string => {
    const repo = typeof value === 'string' && value ? value : cfg.repo;
    if (!/^[A-Za-z0-9_.-]+$/.test(repo)) {
      throw new InputError('Invalid repository name.');
    }
    const allowlist = getAllowedRepos(config, cfg.repo, cfg.owner);
    if (!allowlist.includes(repo)) {
      throw new NotAllowedError(`Repository ${repo} is not approved for artifact uploads.`);
    }
    return repo;
  };

  // ── GET /repos ────────────────────────────────────────────────────────────
  router.get('/repos', requirePublisher, async (_req: Request, res: Response) => {
    try {
      const cfg = getGitHubConfig(config);
      const { owner } = cfg;
      const credentials = await getGitHubCredentials(cfg);
      const octokit = new Octokit({ auth: credentials.token });

      // Installation tokens use the installation endpoint. Keep the user-repo
      // fallback for local configurations that still provide a user token.
      let allPages;
      let usedInstallationEndpoint = true;
      try {
        allPages = await octokit.paginate(
          octokit.apps.listReposAccessibleToInstallation,
          { per_page: 100 },
        );
      } catch (error: any) {
        if (error.status !== 403 && error.status !== 404) throw error;
        usedInstallationEndpoint = false;
        allPages = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
          per_page: 100,
          sort: 'updated',
          affiliation: 'owner,collaborator,organization_member',
        });
      }

      // Keep only repositories from the configured owner and explicit allowlist.
      // User tokens must also advertise push access; installation tokens carry
      // their permissions at the installation level instead.
      const allowlist = new Set(getAllowedRepos(config, cfg.repo, cfg.owner));
      const repos = allPages
        .filter((r: any) =>
          r.owner?.login?.toLowerCase() === owner.toLowerCase() &&
          // GitHub App installation tokens advertise repository access through
          // the installation itself, while these user-role flags remain false.
          (usedInstallationEndpoint || r.permissions?.push === true || r.permissions?.admin === true) &&
          allowlist.has(r.name),
        )
        .map((r: any) => ({
          name: r.name,
          fullName: r.full_name,
          description: r.description ?? '',
          private: r.private,
        }));

      res.json({ repos, owner, targetDir: cfg.targetDir });
    } catch (err: any) {
      logger.error(`List repos failed: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /upload ──────────────────────────────────────────────────────────
  router.post('/upload', requirePublisher, upload.single('file') as unknown as express.RequestHandler, async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided. Use form-field "file".' });
      return;
    }

    const savedPath = req.file.path;
    logger.info(`Binary saved to disk: ${savedPath}`);

    // ── GitHub push (regular or LFS depending on file size) ─────────────────
    try {
      const cfg = getGitHubConfig(config);
      const repo = getAllowedRepo(req.body?.repo, cfg);
      const { owner, branch } = cfg;
      const credentials = await getGitHubCredentials(cfg, repo);
      const octokit = new Octokit({ auth: credentials.token });

      const requestedPath = typeof req.body?.uploadPath === 'string'
        ? req.body.uploadPath
        : cfg.targetDir;
      const uploadPath = normalizeRepoDirectory(requestedPath);
      const safeName   = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const remotePath = uploadPath ? `${uploadPath}/${safeName}` : safeName;
      const fileSize   = req.file.size;

      /** Fetch the SHA of an existing file in the repo (undefined if not found). */
      const getExistingSha = async (): Promise<string | undefined> => {
        try {
          const { data } = await octokit.repos.getContent({ owner, repo, path: remotePath, ref: branch });
          return (!Array.isArray(data) && data.sha) ? data.sha : undefined;
        } catch { return undefined; }
      };

      if (shouldUseLfs(config, safeName, fileSize)) {
        // ── Git LFS path ───────────────────────────────────────────────────
        logger.info(`File qualifies for Git LFS (size: ${(fileSize / 1024 / 1024).toFixed(1)} MB, ext: ${path.extname(safeName)})`);
        const oid = await sha256ofFile(savedPath);

        // 1. Batch request: ask GitHub LFS if/where to upload
        const batchRes = await fetch(
          `https://github.com/${owner}/${repo}.git/info/lfs/objects/batch`,
          {
            method: 'POST',
            headers: {
              ...getGitHubAuthHeaders(credentials),
              'Content-Type':  'application/vnd.git-lfs+json',
              'Accept':        'application/vnd.git-lfs+json',
            },
            body: JSON.stringify({
              operation: 'upload',
              transfers:  ['basic'],
              refs:       { name: `refs/heads/${branch}` },
              objects:    [{ oid, size: fileSize }],
            }),
          },
        );
        if (!batchRes.ok) throw new Error(`LFS batch failed: HTTP ${batchRes.status}`);

        const batchData = await batchRes.json() as any;
        const lfsObj    = batchData.objects?.[0];
        if (!lfsObj)       throw new Error('LFS batch response contained no objects');
        if (lfsObj.error)  throw new Error(`LFS error: ${lfsObj.error.message}`);

        // 2. Upload object if GitHub doesn't have it yet
        if (lfsObj.actions?.upload) {
          const { href, header } = lfsObj.actions.upload as { href: string; header: Record<string, string> };
          logger.info(`Uploading ${(fileSize / 1024 / 1024).toFixed(1)} MB to LFS storage…`);
          await lfsHttpPut(href, header ?? {}, savedPath, fileSize);
          logger.info('LFS object upload complete');
        }

        // 3. Verify (optional action GitHub may include)
        if (lfsObj.actions?.verify) {
          const { href, header } = lfsObj.actions.verify as { href: string; header: Record<string, string> };
          await fetch(href, {
            method: 'POST',
            headers: { ...header, 'Content-Type': 'application/vnd.git-lfs+json' },
            body: JSON.stringify({ oid, size: fileSize }),
          });
        }

        // 4. Commit the LFS pointer file into the repo
        const pointer      = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${fileSize}\n`;
        const existingSha  = await getExistingSha();
        await octokit.repos.createOrUpdateFileContents({
          owner, repo, branch,
          path:    remotePath,
          message: `chore: upload LFS binary ${safeName}`,
          content: Buffer.from(pointer).toString('base64'),
          ...(existingSha ? { sha: existingSha } : {}),
        });

        logger.info(`LFS pointer committed: ${owner}/${repo}/${remotePath}`);
        res.status(200).json({
          message:  'File uploaded via Git LFS and committed to GitHub.',
          lfs:      true,
          github:   { owner, repo, branch, path: remotePath, url: `https://github.com/${owner}/${repo}/blob/${branch}/${remotePath}` },
        });

      } else {
        // ── Regular Contents API path (≤ 100 MB) ──────────────────────────
        const base64Content = fs.readFileSync(savedPath).toString('base64');
        const existingSha   = await getExistingSha();

        await octokit.repos.createOrUpdateFileContents({
          owner, repo, branch,
          path:    remotePath,
          message: `chore: upload binary ${safeName}`,
          content: base64Content,
          ...(existingSha ? { sha: existingSha } : {}),
        });

        logger.info(`File pushed to GitHub: ${owner}/${repo}/${remotePath}`);
        res.status(200).json({
          message:  'File uploaded and pushed to GitHub.',
          lfs:      false,
          github:   { owner, repo, branch, path: remotePath, url: `https://github.com/${owner}/${repo}/blob/${branch}/${remotePath}` },
        });
      }
    } catch (err: any) {
      logger.error(`GitHub push failed: ${err.message}`);
      res.status(502).json({
        message: 'GitHub upload failed.',
        error: 'The artifact could not be published. Check the backend logs.',
      });
    } finally {
      fs.promises.unlink(savedPath).catch(error =>
        logger.warn(`Could not remove temporary upload ${savedPath}: ${error.message}`),
      );
    }
  });

  // ── GET /list ─────────────────────────────────────────────────────────────
  // Lists the contents (files + directories) of a specific path in the repo.
  // ?repo=X  ?path=  (empty = root)
  router.get('/list', requirePublisher, async (req: Request, res: Response) => {
    try {
      const cfg = getGitHubConfig(config);
      const repo    = getAllowedRepo(req.query.repo, cfg);
      const dirPath = normalizeRepoDirectory((req.query.path as string) ?? '');
      const { owner, branch } = cfg;
      const credentials = await getGitHubCredentials(cfg, repo);
      const octokit = new Octokit({ auth: credentials.token });

      let items: object[] = [];
      try {
        const response = await octokit.repos.getContent({
          owner, repo,
          path: dirPath,
          ref: branch,
        });

        if (Array.isArray(response.data)) {
          items = response.data
            .filter((item: any) => item.type === 'file' || item.type === 'dir')
            .map((item: any) => ({
              type:        item.type as 'file' | 'dir',
              name:        item.name  as string,
              path:        item.path  as string,
              sha:         item.sha   as string,
              size:        (item.size as number) ?? 0,
              url:         item.html_url     as string,
              downloadUrl: (item.download_url as string | null) ?? null,
            }));
          // Dirs first, then files, each group sorted alphabetically
          items.sort((a: any, b: any) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return (a.name as string).localeCompare(b.name as string);
          });
        }
      } catch (err: any) {
        if (err.status !== 404) throw err;
      }

      res.json({ items });
    } catch (err: any) {
      logger.error(`List failed: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /delete ─────────────────────────────────────────────────────────
  // Accepts a full file path via ?path= anywhere in the selected repository.
  router.delete('/delete', requirePublisher, async (req: Request, res: Response) => {
    const filePath = req.query.path as string | undefined;
    if (!filePath) {
      res.status(400).json({ error: 'Missing required query param: path' });
      return;
    }
    try {
      const cfg = getGitHubConfig(config);
      const normalizedPath = normalizeRepoPath(filePath);
      const repo   = getAllowedRepo(req.query.repo, cfg);
      const { owner, branch } = cfg;
      const credentials = await getGitHubCredentials(cfg, repo);
      const octokit = new Octokit({ auth: credentials.token });

      // Get current SHA (required by GitHub API)
      const existing = await octokit.repos.getContent({ owner, repo, path: normalizedPath, ref: branch });
      if (Array.isArray(existing.data) || !existing.data.sha) {
        res.status(400).json({ error: 'Target is a directory, not a file.' });
        return;
      }

      await octokit.repos.deleteFile({
        owner, repo,
        path: normalizedPath,
        message: `chore: remove ${normalizedPath}`,
        sha: existing.data.sha,
        branch,
      });
      logger.info(`File deleted from GitHub: ${owner}/${repo}/${normalizedPath}`);

      // Best-effort: remove matching local copy
      const filename = normalizedPath.split('/').pop() ?? normalizedPath;
      try {
        for (const localFile of fs.readdirSync(uploadDir).filter(entry => entry === filename || entry.endsWith(`-${filename}`))) {
          fs.unlinkSync(path.join(uploadDir, localFile));
          logger.info(`Local file removed: ${localFile}`);
        }
      } catch { /* non-critical */ }

      res.json({ message: `File "${normalizedPath}" deleted from GitHub.` });
    } catch (err: any) {
      logger.error(`Delete file failed: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /health ───────────────────────────────────────────────────────────
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return router;
}
