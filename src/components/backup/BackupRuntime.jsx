import { useEffect } from 'react';
import { readBackupSettings } from '../../lib/supabaseBackupUtils';

export default function BackupRuntime() {
  useEffect(() => {
    // 기기별 브라우저 자동 백업 및 실시간 백업 구독은 Supabase Egress 절감을 위해 비활성화하고,
    // 배포/코딩 시점의 Mac 로컬 파일 백업(backups/)으로 대체한다.
    readBackupSettings();
  }, []);

  return null;
}
