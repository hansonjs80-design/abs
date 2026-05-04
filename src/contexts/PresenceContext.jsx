import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from './AuthContext';

const PresenceContext = createContext();

const COLORS = [
  '#FF3B30', '#FF9500', '#FFCC00', '#4CD964', '#5AC8FA',
  '#007AFF', '#5856D6', '#FF2D55', '#E56CE5', '#A2845E'
];

function getSessionId() {
  let sid = sessionStorage.getItem('presence_session_id');
  if (!sid) {
    sid = Math.random().toString(36).substring(2, 15);
    sessionStorage.setItem('presence_session_id', sid);
  }
  return sid;
}

function getSessionColor(sid) {
  let hash = 0;
  for (let i = 0; i < sid.length; i++) {
    hash = sid.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

export function PresenceProvider({ children }) {
  const { user } = useAuth();
  const [remoteUsers, setRemoteUsers] = useState({});
  const channelRef = useRef(null);
  const localStateRef = useRef({
    selectedKeys: [],
    editingCell: null,
    draftValue: ''
  });

  const sessionId = getSessionId();

  useEffect(() => {
    if (!user) {
      setRemoteUsers({});
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      return;
    }

    const channel = supabase.channel('room-presence', {
      config: {
        presence: {
          key: sessionId,
        },
      },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const users = {};
        for (const [key, presences] of Object.entries(state)) {
          if (key === sessionId) continue; // Skip local user
          const presence = presences[presences.length - 1];
          if (presence) {
            users[key] = presence;
          }
        }
        setRemoteUsers(users);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            userId: user.id,
            displayName: user.user_metadata?.name || user.display_name || user.username || '익명',
            color: getSessionColor(sessionId),
            ...localStateRef.current,
          });
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [user, sessionId]);

  const trackTimeoutRef = useRef(null);

  const updatePresence = useCallback((newState) => {
    localStateRef.current = { ...localStateRef.current, ...newState };
    
    if (trackTimeoutRef.current) {
      clearTimeout(trackTimeoutRef.current);
    }
    
    trackTimeoutRef.current = setTimeout(() => {
      if (channelRef.current) {
        channelRef.current.track({
          userId: user?.id,
          displayName: user?.user_metadata?.name || user?.display_name || user?.username || '익명',
          color: getSessionColor(sessionId),
          ...localStateRef.current,
        }).catch(err => console.warn('Failed to track presence', err));
      }
    }, 150);
  }, [user, sessionId]);

  return (
    <PresenceContext.Provider value={{ remoteUsers, updatePresence }}>
      {children}
    </PresenceContext.Provider>
  );
}

export const usePresence = () => useContext(PresenceContext);
