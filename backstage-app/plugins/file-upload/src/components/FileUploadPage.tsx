import { useState, useRef, useEffect, useCallback, type DragEvent } from 'react';
import {
  Button,
  CircularProgress,
  LinearProgress,
  Typography,
  Paper,
  Chip,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  IconButton,
  Tooltip,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Breadcrumbs,
  Link,
} from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import CloudUploadIcon from '@material-ui/icons/CloudUpload';
import CheckCircleIcon from '@material-ui/icons/CheckCircle';
import ErrorIcon from '@material-ui/icons/Error';
import DeleteIcon from '@material-ui/icons/Delete';
import RefreshIcon from '@material-ui/icons/Refresh';
import FolderIcon from '@material-ui/icons/Folder';
import InsertDriveFileIcon from '@material-ui/icons/InsertDriveFile';
import StorageIcon from '@material-ui/icons/Storage';
import { Page, Header, Content } from '@backstage/core-components';
import { discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';

const useStyles = makeStyles(theme => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(3),
    padding: theme.spacing(4),
    maxWidth: 900,
    margin: '0 auto',
  },
  uploadSection: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(2),
  },
  dropZone: {
    width: '100%',
    minHeight: 200,
    border: `2px dashed ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1),
    cursor: 'pointer',
    transition: 'border-color 0.2s',
    padding: theme.spacing(3),
    '&:hover': { borderColor: theme.palette.primary.main },
  },
  dropZoneActive: {
    borderColor: theme.palette.primary.main,
    backgroundColor: theme.palette.action.hover,
  },
  dropZoneDisabled: {
    opacity: 0.4,
    pointerEvents: 'none',
  },
  fileChip: { maxWidth: '100%' },
  progressBar: { width: '100%' },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(1),
  },
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  repoSelect: { minWidth: 320 },
  twoCol: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: theme.spacing(3),
    width: '100%',
    alignItems: 'start',
    [theme.breakpoints.down('sm')]: {
      gridTemplateColumns: '1fr',
    },
  },
  fileLink: {
    color: theme.palette.primary.main,
    textDecoration: 'none',
    '&:hover': { textDecoration: 'underline' },
  },
  resultPaper: {
    width: '100%',
    padding: theme.spacing(2),
  },
  resultSuccess: {
    color: theme.palette.success.main,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  resultError: {
    color: theme.palette.error.main,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  },
  codeBlock: {
    background: theme.palette.background.default,
    borderRadius: theme.shape.borderRadius,
    padding: theme.spacing(1.5),
    fontFamily: 'monospace',
    fontSize: '0.8rem',
    wordBreak: 'break-all',
    marginTop: theme.spacing(1),
  },
}));

type UploadState = 'idle' | 'uploading' | 'success' | 'error';

interface UploadResult {
  message: string;
  lfs?: boolean;
  localPath?: string;
  github?: { owner: string; repo: string; branch: string; path: string; url: string };
  error?: string;
}

interface RepoInfo {
  name: string;
  fullName: string;
  description: string;
  private: boolean;
}

interface RepoItem {
  type: 'file' | 'dir';
  name: string;
  path: string;        // full path from repo root
  sha: string;
  size: number;
  url: string;
  downloadUrl: string | null;
}

export const FileUploadPage = () => {
  const classes = useStyles();
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const [pluginBaseUrl, setPluginBaseUrl] = useState('');

  useEffect(() => {
    let active = true;
    discoveryApi.getBaseUrl('file-upload').then(url => {
      if (active) setPluginBaseUrl(url);
    });
    return () => { active = false; };
  }, [discoveryApi]);

  // ── Repo selector ────────────────────────────────────────────────────────
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [targetDir, setTargetDir] = useState('uploads');
  const [loadingRepos, setLoadingRepos] = useState(false);

  // ── Directory browser ─────────────────────────────────────────────────────
  const [currentPath, setCurrentPath] = useState('');   // '' = root
  const [items, setItems] = useState<RepoItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);

  // ── Upload ────────────────────────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>('idle');
  const [result, setResult] = useState<UploadResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Data fetching ─────────────────────────────────────────────────────────
  const fetchItems = useCallback(async (repo: string, path: string) => {
    if (!repo || !pluginBaseUrl) return;
    setLoadingList(true);
    try {
      const url = `${pluginBaseUrl}/list?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}`;
      const res  = await fetchApi.fetch(url);
      if (!res.ok) throw new Error(`List request failed: HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoadingList(false);
    }
  }, [fetchApi, pluginBaseUrl]);

  const fetchRepos = useCallback(async () => {
    setLoadingRepos(true);
    try {
      if (!pluginBaseUrl) return;
      const res  = await fetchApi.fetch(`${pluginBaseUrl}/repos`);
      if (!res.ok) throw new Error(`Repository request failed: HTTP ${res.status}`);
      const data = await res.json();
      const list: RepoInfo[] = data.repos ?? [];
      setRepos(list);
      if (typeof data.targetDir === 'string' && data.targetDir) setTargetDir(data.targetDir);
      if (list.length > 0 && !selectedRepo) setSelectedRepo(list[0].name);
    } catch {
      setRepos([]);
    } finally {
      setLoadingRepos(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchApi, pluginBaseUrl]);

  useEffect(() => { fetchRepos(); }, [fetchRepos]);

  // Reset to root and reload when repo changes
  useEffect(() => {
    if (selectedRepo) {
      setCurrentPath(targetDir);
      fetchItems(selectedRepo, targetDir);
    }
  }, [selectedRepo, targetDir, fetchItems]);

  // ── Navigation ────────────────────────────────────────────────────────────
  const navigateTo = (path: string) => {
    setCurrentPath(path);
    fetchItems(selectedRepo, path);
  };

  // Breadcrumb segments from currentPath
  const breadcrumbs = currentPath
    ? currentPath.split('/').map((seg, i, arr) => ({
        label: seg,
        path:  arr.slice(0, i + 1).join('/'),
      }))
    : [];

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleFile = (f: File) => { setFile(f); setState('idle'); setResult(null); };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  };

  const handleUpload = async () => {
    if (!file || !selectedRepo) return;
    setState('uploading');
    setResult(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('repo', selectedRepo);
    formData.append('uploadPath', currentPath);   // current directory

    try {
      const response = await fetchApi.fetch(`${pluginBaseUrl}/upload`, { method: 'POST', body: formData });
      const data: UploadResult = await response.json();
      setState(response.ok ? 'success' : 'error');
      setResult(data);
      if (response.ok) {
        fetchItems(selectedRepo, currentPath);
        // Reset the file selection so the drop zone returns to its empty
        // default and the same file can be picked again (a native <input
        // type="file"> won't re-fire onChange unless its value is cleared).
        setFile(null);
        if (inputRef.current) inputRef.current.value = '';
      }
    } catch (err: any) {
      setState('error');
      setResult({ message: 'Request failed', error: err.message });
    }
  };

  const handleDelete = async (item: RepoItem) => {
    // Native confirmation prevents accidental destructive actions.
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${item.path}" from "${selectedRepo}"?`)) return;
    setDeletingFile(item.path);
    try {
      const res = await fetchApi.fetch(
        `${pluginBaseUrl}/delete?path=${encodeURIComponent(item.path)}&repo=${encodeURIComponent(selectedRepo)}`,
        { method: 'DELETE' },
      );
      if (res.ok) fetchItems(selectedRepo, currentPath);
    } finally {
      setDeletingFile(null);
    }
  };

  const LFS_EXTENSIONS = ['.ear', '.exe', '.war', '.jar', '.zip'];
  const willUseLfs = (f: File) =>
    f.size > 100 * 1024 * 1024 || LFS_EXTENSIONS.includes(f.name.substring(f.name.lastIndexOf('.')).toLowerCase());

  const formatSize = (item: RepoItem) => {
    if (item.type === 'dir') return '—';
    if (item.size > 1024 * 1024) return `${(item.size / 1024 / 1024).toFixed(1)} MB`;
    return `${(item.size / 1024).toFixed(1)} KB`;
  };

  const noRepo = !selectedRepo;

  return (
    <Page themeId="tool">
      <Header
        title="Binary File Upload"
        subtitle="Select a repository, upload binaries and manage files on GitHub"
      />
      <Content>
        <div className={classes.root}>

          {/* ── Step 1: Repository selector (full width) ── */}
          <Paper className={classes.resultPaper} variant="outlined">
            <div className={classes.sectionHeader}>
              <div className={classes.sectionTitle}>
                <StorageIcon color="action" />
                <Typography variant="h6">1. Select Repository</Typography>
                {loadingRepos && <CircularProgress size={16} />}
              </div>
              <Tooltip title="Refresh repository list">
                <span>
                  <IconButton size="small" onClick={fetchRepos} disabled={loadingRepos}>
                    <RefreshIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </div>
            <Divider style={{ marginBottom: 16 }} />
            {!loadingRepos && repos.length === 0 && (
              <Typography variant="body2" color="error">
                No repositories found. Check your GitHub token permissions.
              </Typography>
            )}
            {repos.length > 0 && (
              <FormControl variant="outlined" className={classes.repoSelect}>
                <InputLabel id="repo-select-label">Repository</InputLabel>
                <Select
                  labelId="repo-select-label"
                  value={selectedRepo}
                  label="Repository"
                  onChange={e => setSelectedRepo(e.target.value as string)}
                >
                  {repos.map(r => (
                    <MenuItem key={r.name} value={r.name}>
                      <span>
                        {r.private ? '🔒 ' : '📂 '}
                        <strong>{r.name}</strong>
                        {r.description && (
                          <Typography variant="caption" color="textSecondary" style={{ marginLeft: 8 }}>
                            {r.description}
                          </Typography>
                        )}
                      </span>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Paper>

          {/* ── Steps 2 & 3: two-column layout ── */}
          <div className={classes.twoCol}>

            {/* ── Left: directory browser ── */}
            <Paper className={classes.resultPaper} variant="outlined">
              <div className={classes.sectionHeader}>
                <div className={classes.sectionTitle}>
                  <FolderIcon color="action" />
                  <Typography variant="h6">
                    2. Browse {selectedRepo ? <strong>{selectedRepo}</strong> : 'repository'}
                  </Typography>
                  {loadingList && <CircularProgress size={16} />}
                </div>
                <Tooltip title="Refresh">
                  <span>
                    <IconButton size="small" onClick={() => fetchItems(selectedRepo, currentPath)} disabled={loadingList || noRepo}>
                      <RefreshIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </div>
              <Divider style={{ marginBottom: 8 }} />

              {/* Breadcrumb */}
              <Breadcrumbs style={{ padding: '8px 0 8px 0', fontSize: '0.85rem' }}>
                <Link
                  style={{ cursor: 'pointer' }}
                  color={currentPath === '' ? 'textPrimary' : 'inherit'}
                  onClick={() => navigateTo('')}
                >
                  root
                </Link>
                {breadcrumbs.map(seg => (
                  <Link
                    key={seg.path}
                    style={{ cursor: 'pointer' }}
                    color={seg.path === currentPath ? 'textPrimary' : 'inherit'}
                    onClick={() => navigateTo(seg.path)}
                  >
                    {seg.label}
                  </Link>
                ))}
              </Breadcrumbs>
              <Divider />

              {noRepo && (
                <Typography variant="body2" color="textSecondary" style={{ padding: 16, textAlign: 'center' }}>
                  Select a repository to browse its files.
                </Typography>
              )}
              {!noRepo && !loadingList && items.length === 0 && (
                <Typography variant="body2" color="textSecondary" style={{ padding: 16, textAlign: 'center' }}>
                  This directory is empty.
                </Typography>
              )}
              {items.length > 0 && (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell align="right">Size</TableCell>
                      <TableCell align="center">Delete</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map(item => (
                      <TableRow key={item.sha} hover>
                        <TableCell>
                          {item.type === 'dir' ? (
                            <span
                              style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                              role="button"
                              tabIndex={0}
                              onClick={() => navigateTo(item.path)}
                              onKeyDown={event => {
                                if (event.key === 'Enter' || event.key === ' ') navigateTo(item.path);
                              }}
                            >
                              <FolderIcon fontSize="small" style={{ color: '#f0a500' }} />
                              <span style={{ fontWeight: 500 }}>{item.name}/</span>
                            </span>
                          ) : (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <InsertDriveFileIcon fontSize="small" color="action" />
                              <a className={classes.fileLink} href={item.url} target="_blank" rel="noopener noreferrer">
                                {item.name}
                              </a>
                            </span>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          {formatSize(item)}
                        </TableCell>
                        <TableCell align="center">
                          {item.type === 'file' && (
                            <Tooltip title="Delete file from GitHub">
                              <span>
                                <IconButton
                                  size="small"
                                  onClick={() => handleDelete(item)}
                                  disabled={deletingFile === item.path}
                                >
                                  {deletingFile === item.path
                                    ? <CircularProgress size={16} />
                                    : <DeleteIcon color="error" />}
                                </IconButton>
                              </span>
                            </Tooltip>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Paper>

            {/* ── Right: upload ── */}
            <Paper className={classes.resultPaper} variant="outlined">
              <div className={classes.sectionHeader}>
                <div className={classes.sectionTitle}>
                  <CloudUploadIcon color="action" />
                  <Typography variant="h6">3. Upload Binary</Typography>
                </div>
              </div>
              <Divider style={{ marginBottom: 16 }} />
              <div className={classes.uploadSection}>
                <div
                  className={`${classes.dropZone} ${dragging ? classes.dropZoneActive : ''} ${noRepo ? classes.dropZoneDisabled : ''}`}
                  role="button"
                  tabIndex={noRepo ? -1 : 0}
                  onClick={() => !noRepo && inputRef.current?.click()}
                  onKeyDown={event => {
                    if (!noRepo && (event.key === 'Enter' || event.key === ' ')) inputRef.current?.click();
                  }}
                  onDrop={noRepo ? undefined : handleDrop}
                  onDragOver={noRepo ? undefined : e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                >
                  <CloudUploadIcon color="action" style={{ fontSize: 48 }} />
                  <Typography variant="body1" color="textSecondary">
                    {noRepo
                      ? 'Select a repository first'
                      : 'Drag & drop a binary here, or click to select'}
                  </Typography>
                  {file && (
                    <Chip
                      className={classes.fileChip}
                      label={`${file.name} (${file.size > 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${(file.size / 1024).toFixed(1)} KB`})${willUseLfs(file) ? ' · LFS' : ''}`}
                      color={willUseLfs(file) ? 'secondary' : 'primary'}
                      variant="outlined"
                      onDelete={e => { e.stopPropagation(); setFile(null); setState('idle'); }}
                    />
                  )}
                  <input
                    ref={inputRef}
                    type="file"
                    hidden
                    onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
                  />
                </div>

                <Button
                  variant="contained"
                  color="primary"
                  startIcon={state === 'uploading' ? <CircularProgress size={18} color="inherit" /> : <CloudUploadIcon />}
                  onClick={handleUpload}
                  disabled={!file || !selectedRepo || state === 'uploading'}
                >
                  {state === 'uploading' ? 'Uploading…' : `Upload to /${currentPath || selectedRepo || '…'}`}
                </Button>

                {state === 'uploading' && <LinearProgress className={classes.progressBar} />}

                {result && (
                  <Paper className={classes.resultPaper} variant="outlined">
                    <div className={state === 'error' ? classes.resultError : classes.resultSuccess}>
                      {state === 'error' ? <ErrorIcon /> : <CheckCircleIcon />}
                      <Typography variant="subtitle1">{result.message}</Typography>
                      {result.lfs && (
                        <Chip label="Git LFS" size="small" color="secondary" style={{ marginLeft: 8 }} />
                      )}
                    </div>
                    {result.localPath && (
                      <>
                        <Typography variant="caption" color="textSecondary">Saved on server:</Typography>
                        <div className={classes.codeBlock}>{result.localPath}</div>
                      </>
                    )}
                    {result.github?.url && (
                      <>
                        <Typography variant="caption" color="textSecondary">GitHub:</Typography>
                        <div className={classes.codeBlock}>
                          <a href={result.github.url} target="_blank" rel="noopener noreferrer">{result.github.url}</a>
                        </div>
                      </>
                    )}
                    {result.error && (
                      <>
                        <Typography variant="caption" color="error">Error detail:</Typography>
                        <div className={classes.codeBlock}>{result.error}</div>
                      </>
                    )}
                  </Paper>
                )}
              </div>
            </Paper>

          </div>

        </div>
      </Content>
    </Page>
  );
};
