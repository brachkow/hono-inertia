import type { LiveTransport } from '@inertiajs/core';

// Delivers events between tabs of one browser, so the example needs no
// broadcaster. A real app passes a transport for Pusher, Reverb or Action Cable.
export const liveTransport: LiveTransport = {
  subscribe: (channel, event, handler) => {
    const connection = new BroadcastChannel(channel.name);
    connection.addEventListener(
      'message',
      (message: MessageEvent<{ event: string; payload?: unknown }>) => {
        if (message.data.event === event) handler(message.data.payload);
      },
    );
    return () => connection.close();
  },
};
