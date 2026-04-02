type SocketLike = {
  readyState: number;
  send: (payload: string) => void;
};

type DeliverSessionNotificationInput = {
  sockets: Set<SocketLike> | null | undefined;
  openStateValue: number;
  payload: string;
  onSocketStale?: (socket: SocketLike) => void;
};

export async function deliverSessionNotificationToSubscribers(
  input: DeliverSessionNotificationInput,
): Promise<number> {
  const sockets = input.sockets;
  if (!sockets || sockets.size === 0) {
    return 0;
  }

  let delivered = 0;
  const staleSockets: SocketLike[] = [];

  for (const socket of sockets) {
    if (socket.readyState !== input.openStateValue) {
      staleSockets.push(socket);
      continue;
    }

    try {
      socket.send(input.payload);
      delivered += 1;
    } catch {
      staleSockets.push(socket);
    }
  }

  for (const socket of staleSockets) {
    sockets.delete(socket);
    input.onSocketStale?.(socket);
  }

  return delivered;
}
