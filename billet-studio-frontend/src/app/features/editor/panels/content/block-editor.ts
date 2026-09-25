import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  viewChild,
} from '@angular/core';
import { CdkDragHandle } from '@angular/cdk/drag-drop';
import { FormField, type FieldTree } from '@angular/forms/signals';
import { TranslatePipe } from '@ngx-translate/core';

import {
  DIVIDER_STYLES,
  type BilletBlock,
  type BlockType,
  type DividerStyle,
} from '../../../../billet/billet-document';
import { NUMBER_LIMITS } from '../../../../billet/billet-limits';
import { LanguageService } from '../../../../core/services/language-service';
import { EmojiPicker } from '../../../../shared/components/emoji-picker/emoji-picker';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { RangeSlider } from '../../../../shared/components/range-slider/range-slider';
import { BilletText } from '../../billet-text';
import { EditorCommands } from '../../editor-commands';
import { setBlockText } from './block-list';

export interface BlockTypeOption {
  readonly type: BlockType;
  readonly labelKey: string;
  readonly icon: string;
}

export const BLOCK_TYPE_OPTIONS: readonly BlockTypeOption[] = [
  { type: 'paragraph', labelKey: 'EDITOR.BLOCK_TYPES.PARAGRAPH', icon: 'bi-text-paragraph' },
  { type: 'heading', labelKey: 'EDITOR.BLOCK_TYPES.HEADING', icon: 'bi-type-h2' },
  { type: 'card', labelKey: 'EDITOR.BLOCK_TYPES.CARD', icon: 'bi-card-text' },
  { type: 'note', labelKey: 'EDITOR.BLOCK_TYPES.NOTE', icon: 'bi-sticky' },
  { type: 'divider', labelKey: 'EDITOR.BLOCK_TYPES.DIVIDER', icon: 'bi-dash-lg' },
];

export const DIVIDER_STYLE_KEYS: Readonly<Record<DividerStyle, string>> = {
  diamond: 'EDITOR.DIVIDER_STYLES.DIAMOND',
  dot: 'EDITOR.DIVIDER_STYLES.DOT',
  heart: 'EDITOR.DIVIDER_STYLES.HEART',
  star: 'EDITOR.DIVIDER_STYLES.STAR',
  line: 'EDITOR.DIVIDER_STYLES.LINE',
  none: 'EDITOR.DIVIDER_STYLES.NONE',
};

const { min: SPACE_MIN, max: SPACE_MAX } = NUMBER_LIMITS.spaceAdjust;
/** Every step of the space adjustment, marked under its slider. */
const SPACE_MARKS = Array.from({ length: SPACE_MAX - SPACE_MIN + 1 }, (_, i) => SPACE_MIN + i);

/** The DOM id of a block's card; the content panel focuses controls inside it. */
export const blockElementId = (blockId: string) => `editor-block-${blockId}`;

/**
 * One block of the content panel: its type, the fields that type uses (the schema hides the rest)
 * and its actions. Reordering and removal are the list's business; this card only asks for them.
 */
@Component({
  selector: 'app-block-editor',
  imports: [
    BilletText,
    CdkDragHandle,
    EmojiPicker,
    FieldError,
    FormField,
    RangeSlider,
    TranslatePipe,
  ],
  templateUrl: './block-editor.html',
  styleUrl: './block-editor.scss',
})
export class BlockEditor {
  readonly block = input.required<FieldTree<BilletBlock, number>>();
  /** 1-based. */
  readonly position = input.required<number>();
  readonly count = input.required<number>();

  readonly moveBy = output<-1 | 1>();
  readonly duplicate = output<void>();
  readonly remove = output<void>();

  private readonly commands = inject(EditorCommands);
  private readonly injector = inject(Injector);
  private readonly language = inject(LanguageService);
  private readonly textarea = viewChild<ElementRef<HTMLTextAreaElement>>('textarea');

  protected readonly dividerStyles = DIVIDER_STYLES.filter((style) => style !== 'none').map(
    (style) => ({ style, labelKey: DIVIDER_STYLE_KEYS[style] }),
  );

  protected readonly spaceMarks = SPACE_MARKS;
  /** Steps more or less than the usual gap, signed: "+2", "0", "−1". */
  protected readonly spaceText = computed(() => {
    const steps = new Intl.NumberFormat(this.language.locale(), { signDisplay: 'exceptZero' });
    return (value: number) => steps.format(value);
  });

  protected readonly value = computed(() => this.block()().value());
  protected readonly id = computed(() => blockElementId(this.value().id));
  protected readonly type = computed(() =>
    BLOCK_TYPE_OPTIONS.find((option) => option.type === this.value().type)!,
  );
  protected readonly maxText = computed(() => this.block().text().maxLength?.() ?? 0);

  /** Wraps the selection in `marker` (markup: *emphasis*, **strong**) as one undo step. */
  protected wrap(marker: '*' | '**'): void {
    const textarea = this.textarea()?.nativeElement;
    if (!textarea) return;
    const { selectionStart: start, selectionEnd: end, value } = textarea;
    const text =
      value.slice(0, start) + marker + value.slice(start, end) + marker + value.slice(end);
    if (text.length > this.maxText()) return;

    const { id } = this.value();
    this.commands.commit((document) => setBlockText(document, id, text));
    afterNextRender(
      () => {
        textarea.focus();
        textarea.setSelectionRange(start + marker.length, end + marker.length);
      },
      { injector: this.injector },
    );
  }
}
