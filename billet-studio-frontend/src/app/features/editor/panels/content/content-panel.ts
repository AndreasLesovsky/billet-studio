import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { CdkDrag, CdkDropList, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { FormField } from '@angular/forms/signals';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { BILLET_LANGS, createBlock, type BlockType } from '../../../../billet/billet-document';
import { MAX_BLOCKS } from '../../../../billet/billet-limits';
import { FieldError } from '../../../../shared/components/field-error/field-error';
import { ThemeScope } from '../../../../shared/directives/theme-scope';
import { BilletText } from '../../billet-text';
import { EditorCommands } from '../../editor-commands';
import { EditorPanel } from '../editor-panel';
import { BLOCK_TYPE_OPTIONS, BlockEditor, blockElementId } from './block-editor';
import { copyBlock, insertBlock, moveBlock, removeBlock } from './block-list';

const LANGUAGE_KEYS = { de: 'NAV.LANGUAGE_DE', en: 'NAV.LANGUAGE_EN' } as const;

/** The first control of a block: where focus goes when the block appears. */
const BLOCK_FIRST_CONTROL = ':is(textarea, select, input)';

/**
 * The words of the billet: page title and language, the hero lines, the blocks and the signature.
 * Blocks are added after the one last worked on, reordered by drag handle or by the move buttons
 * (keyboard), duplicated and deleted without a question - every change is one undo step.
 */
@Component({
  selector: 'app-content-panel',
  imports: [
    BilletText,
    BlockEditor,
    CdkDrag,
    CdkDropList,
    CdkMenu,
    CdkMenuItem,
    CdkMenuTrigger,
    FieldError,
    FormField,
    ThemeScope,
    TranslatePipe,
  ],
  templateUrl: './content-panel.html',
  styleUrl: './content-panel.scss',
})
export class ContentPanel extends EditorPanel {
  private readonly commands = inject(EditorCommands);
  private readonly translate = inject(TranslateService);
  private readonly injector = inject(Injector);
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;

  protected readonly blockTypes = BLOCK_TYPE_OPTIONS;
  protected readonly maxBlocks = MAX_BLOCKS;
  protected readonly langs = BILLET_LANGS.map((lang) => ({ lang, labelKey: LANGUAGE_KEYS[lang] }));
  protected readonly canAddBlock = computed(() => this.document().blocks.length < MAX_BLOCKS);
  /** Read out by the live region after a block moved or went away. */
  protected readonly announcement = signal('');

  /** Where "add block" inserts: after the block that last had focus. */
  private activeBlockId: string | null = null;

  protected onBlockFocus(blockId: string): void {
    this.activeBlockId = blockId;
  }

  protected addBlock(type: BlockType): void {
    if (!this.canAddBlock()) return;
    const block = createBlock(type);
    this.commands.commit((document) => insertBlock(document, block, this.activeBlockId));
    this.focusIn(block.id, BLOCK_FIRST_CONTROL);
  }

  protected moveBlock(index: number, delta: -1 | 1): void {
    const { id } = this.document().blocks[index];
    this.move(index, index + delta);
    // The card moved in the DOM and lost focus: the same button again, or its twin at an edge.
    const [same, twin] = delta < 0 ? ['up', 'down'] : ['down', 'up'];
    this.focusIn(id, `[data-move="${same}"]:enabled`, `[data-move="${twin}"]`);
  }

  protected onDrop(event: CdkDragDrop<unknown>): void {
    this.move(event.previousIndex, event.currentIndex);
  }

  protected duplicateBlock(index: number): void {
    if (!this.canAddBlock()) return;
    const original = this.document().blocks[index];
    const copy = copyBlock(original);
    this.commands.commit((document) => insertBlock(document, copy, original.id));
    this.focusIn(copy.id, BLOCK_FIRST_CONTROL);
  }

  protected removeBlock(index: number): void {
    const blocks = this.document().blocks;
    const { id, type } = blocks[index];
    const next = blocks[index + 1] ?? blocks[index - 1];
    this.commands.commit((document) => removeBlock(document, id));
    if (this.activeBlockId === id) this.activeBlockId = next?.id ?? null;
    this.announce(this.translate.instant('EDITOR.CONTENT.REMOVED', { type: this.typeName(type) }));
    if (next) this.focusIn(next.id, BLOCK_FIRST_CONTROL);
    else this.focusAfterRender('#editor-add-block');
  }

  /** One undo step; the live region says where the block is now. */
  private move(from: number, to: number): void {
    const blocks = this.document().blocks;
    const block = blocks[from];
    if (!block || from === to) return;
    this.commands.commit((document) => moveBlock(document, from, to));
    this.announce(
      this.translate.instant('EDITOR.CONTENT.MOVED', {
        type: this.typeName(block.type),
        position: to + 1,
        count: blocks.length,
      }),
    );
  }

  /** Empties the live region for one render first, so the same message twice is read twice. */
  private announce(message: string): void {
    this.announcement.set('');
    afterNextRender(() => this.announcement.set(message), { injector: this.injector });
  }

  private typeName(type: BlockType): string {
    const option = BLOCK_TYPE_OPTIONS.find((o) => o.type === type);
    return option ? this.translate.instant(option.labelKey) : type;
  }

  private focusIn(blockId: string, ...selectors: string[]): void {
    this.focusAfterRender(
      ...selectors.map((selector) => `#${blockElementId(blockId)} ${selector}`),
    );
  }

  /** Focuses the first element one of the selectors finds, in their order. */
  private focusAfterRender(...selectors: string[]): void {
    afterNextRender(
      () => {
        const found = selectors.map((s) => this.host.querySelector<HTMLElement>(s)).find(Boolean);
        found?.focus();
      },
      { injector: this.injector },
    );
  }
}
