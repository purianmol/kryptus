import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const messageListenersRef = useRef([]);
  const deliveryListenersRef = useRef([]);
  const typingListenersRef = useRef([]);

  // Connect when user is authenticated
  useEffect(() => {
    if (!user) {
      return;
    }

    const token = localStorage.getItem('accessToken');
    if (!token) return;

    const socketUrl = import.meta.env.VITE_API_URL || '/';

    const newSocket = io(socketUrl, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    newSocket.on('connect', () => {
      console.log('🟢 Socket connected');
      setConnected(true);
      setReconnecting(false);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('🔴 Socket disconnected:', reason);
      setConnected(false);
      // Only set reconnecting if we intend to reconnect automatically
      if (reason !== 'io client disconnect') {
        setReconnecting(true);
      }
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message);
      setConnected(false);
      setReconnecting(true);
    });

    newSocket.on('reconnect', () => {
      console.log('🔄 Socket reconnected');
      setConnected(true);
      setReconnecting(false);
    });

    newSocket.on('reconnect_attempt', () => {
      setReconnecting(true);
    });

    newSocket.on('reconnect_failed', () => {
      setReconnecting(false);
    });

    newSocket.on('users_online', (userIds) => {
      setOnlineUsers(userIds);
    });

    newSocket.on('receive_message', (data) => {
      messageListenersRef.current.forEach((listener) => listener(data));
    });

    newSocket.on('msg_delivered', (data) => {
      deliveryListenersRef.current.forEach((listener) => listener(data));
    });

    newSocket.on('msg_sent', (data) => {
      deliveryListenersRef.current.forEach((listener) =>
        listener({ ...data, type: 'sent' })
      );
    });

    newSocket.on('typing_start', (data) => {
      typingListenersRef.current.forEach((listener) =>
        listener({ ...data, typing: true })
      );
    });

    newSocket.on('typing_stop', (data) => {
      typingListenersRef.current.forEach((listener) =>
        listener({ ...data, typing: false })
      );
    });

    newSocket.on('error_message', (data) => {
      console.error('Socket error:', data.error);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
      setSocket(null);
      setConnected(false);
      setReconnecting(false);
    };
  }, [user]);

  // ── Send message (encrypted payload) ──
  const sendMessage = useCallback(
    (recipientId, messageId, ciphertext, iv) => {
      if (socket && connected) {
        socket.emit('send_message', { recipientId, messageId, ciphertext, iv });
      }
    },
    [socket, connected]
  );

  // ── Acknowledge message receipt ──
  const ackMessage = useCallback(
    (messageId) => {
      if (socket && connected) {
        socket.emit('msg_ack', { messageId });
      }
    },
    [socket, connected]
  );

  // ── Typing indicators ──
  const emitTyping = useCallback(
    (recipientId, isTyping) => {
      if (socket && connected) {
        socket.emit(isTyping ? 'typing_start' : 'typing_stop', { recipientId });
      }
    },
    [socket, connected]
  );

  // ── Listener registration ──
  const onMessage = useCallback((listener) => {
    messageListenersRef.current.push(listener);
    return () => {
      messageListenersRef.current = messageListenersRef.current.filter(
        (l) => l !== listener
      );
    };
  }, []);

  const onDelivery = useCallback((listener) => {
    deliveryListenersRef.current.push(listener);
    return () => {
      deliveryListenersRef.current = deliveryListenersRef.current.filter(
        (l) => l !== listener
      );
    };
  }, []);

  const onTyping = useCallback((listener) => {
    typingListenersRef.current.push(listener);
    return () => {
      typingListenersRef.current = typingListenersRef.current.filter(
        (l) => l !== listener
      );
    };
  }, []);

  return (
    <SocketContext.Provider
      value={{
        socket,
        connected,
        reconnecting,
        onlineUsers,
        sendMessage,
        ackMessage,
        emitTyping,
        onMessage,
        onDelivery,
        onTyping,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
}
