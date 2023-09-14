import * as core from '@actions/core';
import {Message as MessageBuilder, Blocks} from 'slack-block-builder';
import {IncomingWebhook} from '@slack/webhook';
import {WEBHOOK_URL} from './config';

export abstract class Message {
  protected messageBody: any;
  protected isSendable = false;
  abstract buildMessage(
    toolName: string,
    repoName: string,
    toolEolDate?: string
  ): void;
  abstract sendMessage(): void;
  protected createGreeting(): string {
    const dateFormatOptions: any = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    };
    const currentDate = new Date(Date.now()).toLocaleDateString(
      'en-GB',
      dateFormatOptions
    );

    return `:warning: *New deprecation alert for ${currentDate}.*`;
  }
}

export class SlackMessage extends Message {
  constructor() {
    super();
    this.messageBody = MessageBuilder();
  }

  buildMessage(messageText: string): void {
    const formattedMessage = messageText.replace('Hello :wave:', '').trim();
    this.messageBody.blocks(
      Blocks.Section({text: this.createGreeting()}),
      Blocks.Section({text: formattedMessage}),
      Blocks.Divider()
    );
    this.isSendable = true;
  }

  async sendMessage(): Promise<void> {
    try {
      if (!WEBHOOK_URL) {
        core.setFailed('Missing Slack webhook URL');
        return;
      }
      if (this.isSendable) {
        const webhook = new IncomingWebhook(WEBHOOK_URL);
        await webhook.send(this.messageBody.buildToObject());
      }
    } catch (error) {
      core.error((error as Error).message);
    }
  }
}
