import { maxLength, schema } from '@angular/forms/signals';

/** Mirrors AssistTurnDto.MAX_MESSAGE_LENGTH. */
const ASSIST_MESSAGE_MAX_LENGTH = 300;

/** One message to the billet assistant; sent as the newest user turn of AssistRequest. */
export interface BilletAssistantFormModel {
  message: string;
}

export const EMPTY_MODEL: BilletAssistantFormModel = { message: '' };

// No required rule: a chat composer does not scold an empty message, its send button just waits.
// The bound also lands on the textarea as maxlength, so the message cannot outgrow it.
export const billetAssistantSchema = schema<BilletAssistantFormModel>((p) => {
  maxLength(p.message, ASSIST_MESSAGE_MAX_LENGTH, { message: 'FORMS.MAX_LENGTH' });
});
