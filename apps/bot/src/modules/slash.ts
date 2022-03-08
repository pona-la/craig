import { DexareModule, DexareClient, BaseConfig } from 'dexare';
import {
  ComponentActionRow,
  ComponentContext,
  ComponentType,
  GatewayServer,
  SlashCreator,
  SlashCreatorOptions,
  TextInputStyle
} from 'slash-create';
import path from 'node:path';
import RecorderModule from './recorder';
import { CraigBotConfig } from '../bot';
import { RecordingState } from './recorder/recording';
import { blessServer, checkRecordingPermission, disableComponents, unblessServer } from '../util';
import { prisma } from '../prisma';

export interface SlashConfig extends BaseConfig {
  applicationID: string;
  slash?: SlashModuleOptions;
}

export interface SlashModuleOptions {
  creator?: SlashCreatorOptions;
}

export default class SlashModule<T extends DexareClient<SlashConfig>> extends DexareModule<T> {
  creator: SlashCreator;

  constructor(client: T) {
    super(client, {
      name: 'slash',
      description: 'Slash command handler'
    });

    this.creator = new SlashCreator({
      ...(this.client.config.slash?.creator ?? {}),
      token: this.client.config.token,
      applicationID: this.client.config.applicationID,
      client
    });
    this.filePath = __filename;
  }

  load() {
    this.creator
      .withServer(
        new GatewayServer((handler) =>
          this.registerEvent('rawWS', (_, event) => {
            if (event.t === 'INTERACTION_CREATE') handler(event.d as any);
          })
        )
      )
      .registerCommandsIn(path.join(__dirname, '../commands'));

    this.creator.on('warn', (message) => this.logger.warn(message));
    this.creator.on('error', (error) => this.logger.error(error.stack || error.toString()));
    this.creator.on('commandRun', (command, _, ctx) =>
      this.logger.debug(
        `${ctx.user.username}#${ctx.user.discriminator} (${ctx.user.id}) ran command ${command.commandName}`
      )
    );
    this.creator.on('commandError', (command, error) => {
      this.logger.error(`Command ${command.commandName} errored:`, error.stack || error.toString());
    });
    this.creator.on('componentInteraction', async (ctx) => {
      if (ctx.customID.startsWith('rec:')) await this.handleRecordingInteraction(ctx);
      else if (ctx.customID.startsWith('user:')) await this.handleUserInteraction(ctx);
    });
  }

  get recorder(): RecorderModule<DexareClient<CraigBotConfig>> {
    return this.client.modules.get('recorder') as RecorderModule<any>;
  }

  unload() {
    this.unregisterAllEvents();
  }

  get config() {
    return this.client.config.slash;
  }

  async handleRecordingInteraction(ctx: ComponentContext) {
    const [, recordingID, action] = ctx.customID.split(':');
    const recording = this.recorder.find(recordingID);
    if (!recording) {
      await ctx.editParent({ components: disableComponents(ctx.message.components as ComponentActionRow[]) });
      return ctx.send({
        content: 'That recording was not found or may have already ended.',
        ephemeral: true
      });
    }
    if (recording.channel.guild.id !== ctx.guildID) return;
    const hasPermission = checkRecordingPermission(
      ctx.member!,
      await prisma.guild.findFirst({ where: { id: ctx.guildID } })
    );
    if (!hasPermission)
      return ctx.send({
        content: 'You need the `Manage Server` permission or have an access role to manage recordings.',
        ephemeral: true
      });

    if (action === 'stop') {
      await recording.stop(false, ctx.user.id);
      await ctx.acknowledge();
    } else if (action === 'note') {
      await ctx.sendModal(
        {
          title: 'Add a note to this recording',
          components: [
            {
              type: ComponentType.ACTION_ROW,
              components: [
                {
                  type: ComponentType.TEXT_INPUT,
                  label: 'Note',
                  style: TextInputStyle.PARAGRAPH,
                  custom_id: 'note',
                  placeholder: 'Chapter 1, Part 1, etc.'
                }
              ]
            }
          ]
        },
        (modalCtx) => {
          if (recording.state === RecordingState.ENDED || recording.state === RecordingState.ERROR)
            return modalCtx.send({
              content: 'That recording was not found or may have already ended.',
              ephemeral: true
            });
          try {
            recording.note(modalCtx.values.note);
            recording.pushToActivity(`${ctx.user.mention} added a note.`);
            return modalCtx.send({
              content: 'Added the note to the recording!',
              ephemeral: true
            });
          } catch (e) {
            recording.recorder.logger.error(`Error adding note to recording ${recordingID}:`, e);
            return modalCtx.send({
              content: 'An error occurred while adding the note.',
              ephemeral: true
            });
          }
        }
      );
    }
    await ctx.acknowledge();
  }

  async handleUserInteraction(ctx: ComponentContext) {
    const [, action, ...args] = ctx.customID.split(':');
    if (ctx.message.interaction!.user.id !== ctx.user.id)
      return ctx.send({
        content: 'Only the person who executed this command can use this button.',
        ephemeral: true
      });

    switch (action) {
      case 'bless': {
        const [guildID] = args;
        try {
          await ctx.editParent({ components: [] });
          await ctx.send(await blessServer(ctx.user.id, guildID));
        } catch (e) {
          this.logger.error(`Error blessing server ${guildID}:`, e);
          await ctx.send({
            content: 'An error occurred while blessing the server.',
            ephemeral: true
          });
        }
        return;
      }
      case 'unbless': {
        const [guildID] = args;
        try {
          await ctx.editParent({ components: [] });
          await ctx.send(await unblessServer(ctx.user.id, guildID));
        } catch (e) {
          this.logger.error(`Error unblessing server ${guildID}:`, e);
          await ctx.send({
            content: 'An error occurred while removing the blessing from the server.',
            ephemeral: true
          });
        }
        return;
      }
    }
  }
}