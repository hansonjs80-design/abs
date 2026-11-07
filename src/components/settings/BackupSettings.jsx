import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  DatabaseBackup,
  Download,
  FileText,
  HardDrive,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useToast } from '../common/Toast';
import {
  BACKUP_TABLES,
  createFullBackupSnapshot,
  deleteBackupSnapshot,
  downloadRestoreReadme,
  downloadSnapshotJson,
  getBackupChangeEventCount,
  getBackupSnapshot,
  getSnapshotRowCount,
  importBackupSnapshot,
  isSnapshotPartial,
  listBackupSnapshots,
  readBackupSettings,
  saveBackupSnapshot,
} from '../../lib/supabaseBackupUtils';

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

function NoticeBox({ children, tone = 'info' }) {
  return (
    <div className={`backup-notice backup-notice--${tone}`}>
      <AlertTriangle size={17} />
      <div>{children}</div>
    </div>
  );
}

function SnapshotSummary({ snapshot }) {
  if (!snapshot) {
    return (
      <div className="backup-snapshot-empty">
        아직 선택된 백업 스냅샷이 없습니다.
      </div>
    );
  }

  return (
    <div className="backup-snapshot-summary">
      <div className="backup-snapshot-pills">
        <span className="backup-pill">생성: {formatDateTime(snapshot.created_at)}</span>
        <span className="backup-pill">전체 {getSnapshotRowCount(snapshot).toLocaleString()}행</span>
        <span className="backup-pill">{snapshot.reason === 'auto' ? '자동 백업' : '수동/가져온 백업'}</span>
        {isSnapshotPartial(snapshot) && <span className="backup-pill backup-pill-warning">일부 테이블 오류</span>}
      </div>
      <div className="backup-table-wrap">
        <table className="backup-table">
          <thead>
            <tr>
              <th>테이블</th>
              <th>내용</th>
              <th>행 수</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {BACKUP_TABLES.map((table) => {
              const tableBackup = snapshot.tables?.[table.name];
              const count = Array.isArray(tableBackup?.rows) ? tableBackup.rows.length : 0;
              return (
                <tr key={table.name}>
                  <td>{table.name}</td>
                  <td>
                    {table.label}
                    {table.sensitive && <span style={{ marginLeft: 6, color: '#b45309' }}>민감정보</span>}
                  </td>
                  <td className="backup-table-count">{count.toLocaleString()}행</td>
                  <td className={tableBackup?.error ? 'backup-table-error' : 'backup-table-success'}>
                    {tableBackup?.error ? tableBackup.error : '완료'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function BackupSettings() {
  const { addToast } = useToast();
  const fileInputRef = useRef(null);
  const selectedIdRef = useRef('');
  const [settings] = useState(() => readBackupSettings());
  const [snapshots, setSnapshots] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedSnapshot, setSelectedSnapshot] = useState(null);
  const [changeEventCount, setChangeEventCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const selectedSnapshotMeta = useMemo(
    () => snapshots.find((snapshot) => snapshot.id === selectedId) || null,
    [selectedId, snapshots]
  );

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const refreshSnapshots = useCallback(async (preferredId) => {
    const [nextSnapshots, nextEventCount] = await Promise.all([
      listBackupSnapshots(),
      getBackupChangeEventCount(),
    ]);
    setSnapshots(nextSnapshots);
    setChangeEventCount(nextEventCount);
    const nextSelectedId = preferredId === undefined
      ? selectedIdRef.current || nextSnapshots[0]?.id || ''
      : preferredId || nextSnapshots[0]?.id || '';
    setSelectedId(nextSelectedId);
    if (nextSelectedId) {
      setSelectedSnapshot(await getBackupSnapshot(nextSelectedId));
    } else {
      setSelectedSnapshot(null);
    }
  }, []);

  useEffect(() => {
    refreshSnapshots().catch((error) => {
      console.error('Failed to load backup snapshots:', error);
      setMessage(`백업 목록을 불러오지 못했습니다: ${error.message}`);
    });
  }, [refreshSnapshots]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedSnapshot(null);
      return;
    }
    getBackupSnapshot(selectedId)
      .then(setSelectedSnapshot)
      .catch((error) => {
        console.error('Failed to load backup snapshot:', error);
        setMessage(`선택한 백업을 불러오지 못했습니다: ${error.message}`);
      });
  }, [selectedId]);

  const handleCreateSnapshot = async () => {
    setBusy(true);
    setMessage('Supabase 데이터를 읽어서 로컬 백업 스냅샷을 만드는 중입니다.');
    try {
      const snapshot = await createFullBackupSnapshot(supabase, { reason: 'manual' });
      await saveBackupSnapshot(snapshot, { maxSnapshots: settings.maxSnapshots });
      await refreshSnapshots(snapshot.id);
      setMessage(isSnapshotPartial(snapshot)
        ? '일부 테이블 백업에 실패했습니다. 상세 목록을 확인한 뒤 JSON을 보관하세요.'
        : '전체 백업 스냅샷을 만들었습니다. 안전한 보관을 위해 JSON 내보내기를 권장합니다.');
      addToast?.('전체 백업이 완료되었습니다.', 'success');
    } catch (error) {
      console.error('Failed to create backup snapshot:', error);
      setMessage(`백업 생성 실패: ${error.message}`);
      addToast?.('백업 생성에 실패했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleExportJson = () => {
    if (!selectedSnapshot) return;
    downloadSnapshotJson(selectedSnapshot);
  };

  const handleExportReadme = () => {
    if (!selectedSnapshot) return;
    downloadRestoreReadme(selectedSnapshot);
  };

  const handleDeleteSnapshot = async () => {
    if (!selectedId || !window.confirm('선택한 로컬 백업 스냅샷을 삭제할까요? Supabase DB에는 영향을 주지 않습니다.')) return;
    setBusy(true);
    try {
      await deleteBackupSnapshot(selectedId);
      await refreshSnapshots('');
      setMessage('선택한 로컬 백업 스냅샷을 삭제했습니다.');
    } catch (error) {
      setMessage(`삭제 실패: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const imported = await importBackupSnapshot(JSON.parse(text), { maxSnapshots: settings.maxSnapshots });
      await refreshSnapshots(imported.id);
      setMessage('백업 JSON 파일을 이 브라우저 로컬 저장소로 가져왔습니다.');
    } catch (error) {
      console.error('Failed to import backup snapshot:', error);
      setMessage(`가져오기 실패: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="backup-settings">
      <div className="card settings-card">
        <div className="card-header">
          <div>
            <span className="card-title"><HardDrive size={18} /> 로컬 백업 설정</span>
            <p className="settings-card-description">Supabase 데이터를 이 브라우저에 안전하게 보관합니다.</p>
          </div>
        </div>
        <div className="card-body backup-settings-body">
          <div className="backup-notices">
            <NoticeBox tone="info">
              기기별 브라우저 자동 백업은 Supabase 데이터 전송량(Egress) 보호를 위해 비활성화되었습니다. 코딩·배포(git push) 시 맥(Mac)의 <code>backups/</code> 폴더에 자동으로 로컬 백업 파일이 생성됩니다.
            </NoticeBox>
            <NoticeBox>
              필요 시 아래 <strong>지금 전체 백업</strong> 버튼을 눌러 수동으로 스냅샷을 만들고 JSON으로 내보낼 수 있습니다.
            </NoticeBox>
          </div>

          <div className="backup-primary-actions">
            <button type="button" className="btn btn-primary" onClick={handleCreateSnapshot} disabled={busy}>
              <DatabaseBackup size={16} /> 지금 전체 백업
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => refreshSnapshots()} disabled={busy}>
              <RefreshCw size={16} /> 목록 새로고침
            </button>
          </div>

          {message && (
            <div className="backup-message">
              {message}
            </div>
          )}
        </div>
      </div>

      <div className="card settings-card">
        <div className="card-header">
          <div>
            <span className="card-title"><Activity size={18} /> 백업 스냅샷</span>
            <p className="settings-card-description">저장된 백업을 확인하거나 JSON 파일로 관리합니다.</p>
          </div>
          <span className="settings-count-badge">{snapshots.length}개</span>
        </div>
        <div className="card-body backup-snapshot-body">
          <div className="backup-snapshot-toolbar">
            <select
              className="form-input"
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              <option value="">백업 스냅샷 선택</option>
              {snapshots.map((snapshot) => (
                <option key={snapshot.id} value={snapshot.id}>
                  {formatDateTime(snapshot.created_at)} · {getSnapshotRowCount(snapshot).toLocaleString()}행 · {snapshot.partial ? '부분 백업' : '정상'}
                </option>
              ))}
            </select>
            <div className="backup-snapshot-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleExportJson} disabled={!selectedSnapshot}>
                <Download size={15} /> JSON 내보내기
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleExportReadme} disabled={!selectedSnapshot}>
                <FileText size={15} /> 복구 안내
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                <Upload size={15} /> JSON 가져오기
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={handleDeleteSnapshot} disabled={!selectedSnapshotMeta || busy}>
                <Trash2 size={15} /> 로컬 삭제
              </button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />

          <SnapshotSummary snapshot={selectedSnapshot} />

          <div className="backup-stats">
            <span>저장된 스냅샷: {snapshots.length.toLocaleString()}개</span>
            <span>실시간 변경 로그: {changeEventCount.toLocaleString()}개</span>
            <span>민감정보 포함: 로그인 사용자 테이블</span>
          </div>
        </div>
      </div>
    </div>
  );
}
