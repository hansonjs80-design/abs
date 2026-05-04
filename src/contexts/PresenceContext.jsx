import { createContext, useContext, useCallback } from 'react';

const PresenceContext = createContext();

const EMPTY_USERS = Object.freeze({});

/**
 * Presence 기능 비활성화 – 실시간 데이터 동기화는 ScheduleContext에서 처리.
 * 셀 선택/편집 추적은 네트워크 부하가 커서 비활성화함.
 */
export function PresenceProvider({ children }) {
  const updatePresence = useCallback(() => {}, []);

  return (
    <PresenceContext.Provider value={{ remoteUsers: EMPTY_USERS, updatePresence }}>
      {children}
    </PresenceContext.Provider>
  );
}

export const usePresence = () => useContext(PresenceContext);

