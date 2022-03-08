import { DexareModule } from 'dexare';
import { nanoid } from 'nanoid';
import { CraigBot } from '../bot';
import type { ManagerResponseMessage } from '../sharding/types';

// @ts-ignore
export default class ShardingModule extends DexareModule<CraigBot> {
  _awaitedPromises = new Map<string, { resolve: (value: any) => void; reject: (reason?: unknown) => void }>();

  constructor(client: any) {
    super(client, {
      name: 'sharding',
      description: 'Module for communicating with the shard master'
    });

    this.filePath = __filename;
  }

  load() {
    if (!process.env.SHARD_COUNT || !process.send) this.logger.info('Shard master not found, skipping...');
    process.on('message', this.onMessage.bind(this));
    this.registerEvent('ready', this.onReady.bind(this));
    this.registerEvent('shardResume', this.onResume.bind(this));
    this.registerEvent('shardDisconnect', this.onDisconnect.bind(this));
    this.registerEvent('debug', this.onDebug.bind(this));
  }

  unload() {
    this.unregisterAllEvents();
  }

  async onMessage(message: any) {
    if (!process.env.SHARD_COUNT || !process.send) return;

    if (typeof message === 'object') {
      // Respond to requests
      if (message.r && this._awaitedPromises.has(message.r)) {
        const { resolve } = this._awaitedPromises.get(message.r)!;
        this._awaitedPromises.delete(message.r);
        resolve(message);
        return;
      }

      switch (message.t) {
        case 'fetchProp': {
          try {
            const result = eval('this.client.' + message.d.prop);
            this.respond(message.n, { result });
          } catch (e) {
            this.respond(message.n, { result: null, error: e });
          }
          return;
        }
        case 'eval': {
          try {
            const result = function () {
              return eval(message.d.script);
            }.bind(this.client)();
            this.respond(message.n, { result });
          } catch (e) {
            this.respond(message.n, { result: null, error: e });
          }
          return;
        }
      }

      this.client.events.emit('processMessage', message);
    }
  }

  onReady() {
    this.send('ready');
  }

  onDisconnect(_: any, error: Error) {
    this.send('disconnect', { error });
  }

  onResume() {
    this.send('resuming');
  }

  onDebug(_: any, message: string) {
    if (
      [
        'Immediately reconnecting for potential resume',
        'Queueing reconnect in ',
        'Automatically invalidating session due to excessive resume attempts'
      ].some((st) => message.startsWith(st))
    ) {
      this.client.emit('logger', 'info', 'eris', [message]);
      this.send('reconnecting', { msg: message });
    }
  }

  send(type: string, data: Record<string, any> = {}): void {
    process.send?.({
      t: type,
      n: nanoid(),
      d: {
        _guilds: this.client.bot.guilds.size,
        _status: this.client.shard?.status,
        ...data
      }
    });
  }

  respond(nonce: string, data: Record<string, any>): void {
    process.send?.({
      r: nonce,
      d: {
        _guilds: this.client.bot.guilds.size,
        _status: this.client.shard?.status,
        ...data
      }
    });
  }

  sendAndRecieve<T = any>(type: string, data: Record<string, any> = {}): Promise<ManagerResponseMessage<T>> {
    return new Promise((resolve, reject) => {
      if (!process.env.SHARD_COUNT || !process.send) return reject(new Error('This is not sharded.'));

      const nonce = nanoid();
      this._awaitedPromises.set(nonce, { resolve, reject });
      process.send({
        t: type,
        n: nonce,
        d: {
          _guilds: this.client.bot.guilds.size,
          _status: this.client.shard?.status,
          ...data
        }
      });
    });
  }
}