import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  forwardRef,
  inject,
  Injector,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { form } from '@angular/forms/signals';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { createDocument, type BilletDocument } from '../../billet/billet-document';
import { mediaQuery } from '../../billet/view/media-query';
import { AssetCatalogApi } from '../../core/services/asset-catalog-api';
import { LocalBilletStore } from '../../core/services/local-billet-store';
import { ConfirmationModalStore } from '../../core/stores/confirmation-modal-store';
import { BreadcrumbService } from '../../shared/components/breadcrumb/breadcrumb-service';
import { ThemeScope } from '../../shared/directives/theme-scope';
import { createEditorAutosave } from './editor-autosave';
import { EditorCommands } from './editor-commands';
import { createEditorHistory, historyShortcut, type HistoryAction } from './editor-history';
import { EditorRemoteNotice, type RemoteChange } from './editor-remote-notice';
import { billetSchema } from './editor-schema';
import { EditorToolbar, type PreviewMode } from './editor-toolbar';
import { ContentPanel } from './panels/content/content-panel';
import { DesignPanel } from './panels/design/design-panel';
import { ParticlesPanel } from './panels/particles/particles-panel';
import { ScenePanel } from './panels/scene/scene-panel';
import { SpacingPanel } from './panels/spacing/spacing-panel';
import { PreviewFrame } from './preview-frame/preview-frame';

type EditorLayout = 'wide' | 'medium' | 'narrow';
type InspectorTab = 'design' | 'spacing' | 'scene' | 'particles';
type EditorTab = 'preview' | 'content' | InspectorTab;

// The layout is decided here, once, and styled through the host class: three columns from 75rem,
// two from md (48rem, src/styles/_breakpoints.scss), below that one panel at a time.
const WIDE_QUERY = '(width >= 75rem)';
const MEDIUM_QUERY = '(width >= 48rem)';

interface TabOption {
  readonly id: EditorTab;
  readonly labelKey: string;
  readonly icon: string;
}

const TAB_OPTIONS: Readonly<Record<EditorTab, TabOption>> = {
  preview: { id: 'preview', labelKey: 'EDITOR.TABS.PREVIEW', icon: 'bi-eye' },
  content: { id: 'content', labelKey: 'EDITOR.TABS.CONTENT', icon: 'bi-body-text' },
  design: { id: 'design', labelKey: 'EDITOR.TABS.DESIGN', icon: 'bi-palette' },
  spacing: { id: 'spacing', labelKey: 'EDITOR.TABS.SPACING', icon: 'bi-distribute-vertical' },
  scene: { id: 'scene', labelKey: 'EDITOR.TABS.SCENE', icon: 'bi-badge-3d' },
  particles: { id: 'particles', labelKey: 'EDITOR.TABS.PARTICLES', icon: 'bi-stars' },
};

const INSPECTOR_TABS: readonly EditorTab[] = ['design', 'spacing', 'scene', 'particles'];
const TABS_BY_LAYOUT: Readonly<Record<EditorLayout, readonly EditorTab[]>> = {
  wide: INSPECTOR_TABS,
  medium: ['content', ...INSPECTOR_TABS],
  narrow: ['preview', 'content', ...INSPECTOR_TABS],
};

const isInspectorTab = (tab: EditorTab): tab is InspectorTab => INSPECTOR_TABS.includes(tab);

/** A panel is a tab's panel where a tab shows it, else a named region of the page. */
function panelSemantics(tab: EditorTab, isTabPanel: boolean) {
  return isTabPanel
    ? { role: 'tabpanel', labelledBy: `editor-tab-${tab}`, labelKey: null }
    : { role: 'region', labelledBy: null, labelKey: TAB_OPTIONS[tab].labelKey };
}

/**
 * The billet editor, /billets/local/:localId/edit. Its root renders in the billet's editor theme
 * (ThemeScope); the site header above stays in the site theme. The form model IS the document:
 * every edit lands in `model`, the history takes it in, the autosave writes it to this device and
 * the preview shows it. Panels bind `billetForm` and ask for bigger steps through EditorCommands.
 */
@Component({
  selector: 'app-editor',
  imports: [
    ContentPanel,
    DesignPanel,
    EditorRemoteNotice,
    EditorToolbar,
    ParticlesPanel,
    PreviewFrame,
    RouterLink,
    ScenePanel,
    SpacingPanel,
    ThemeScope,
    TranslatePipe,
  ],
  templateUrl: './editor.html',
  styleUrl: './editor.scss',
  providers: [{ provide: EditorCommands, useExisting: forwardRef(() => Editor) }],
  host: {
    '[class]': "'editor--' + layout()",
    '(input)': 'history.record()',
    '(change)': 'history.seal()',
    '(focusout)': 'history.seal()',
    '(keydown)': 'onShortcut($event, historyShortcut($event))',
    '(beforeinput)': 'onShortcut($event, historyShortcut($event))',
  },
})
export class Editor implements EditorCommands {
  private readonly store = inject(LocalBilletStore);
  private readonly route = inject(ActivatedRoute);
  private readonly catalog = inject(AssetCatalogApi);
  private readonly translate = inject(TranslateService);
  private readonly confirmation = inject(ConfirmationModalStore);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly injector = inject(Injector);
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;

  protected readonly localId = signal(this.route.snapshot.paramMap.get('localId') ?? '');
  private readonly stored = this.store.load(this.localId());
  /** False for a localId this browser does not know: the page says so instead of editing. */
  protected readonly found = signal(this.stored !== null);

  readonly model = signal<BilletDocument>(this.stored ?? createDocument({ lang: 'de' }));
  readonly billetForm = form(this.model, billetSchema);

  protected readonly history = createEditorHistory(this.model);
  protected readonly historyShortcut = historyShortcut;
  protected readonly canUndo = this.history.canUndo;
  protected readonly canRedo = this.history.canRedo;

  private readonly autosave = createEditorAutosave({
    model: this.model,
    save: (document) => this.store.save(this.localId(), document),
    enabled: this.found,
  });
  protected readonly saveStatus = this.autosave.status;
  protected readonly saveFailure = this.autosave.failure;
  /** Another tab changed or removed this billet while it had edits here. */
  protected readonly remote = signal<RemoteChange | null>(null);

  private readonly wide = mediaQuery(WIDE_QUERY);
  private readonly medium = mediaQuery(MEDIUM_QUERY);
  protected readonly layout = computed<EditorLayout>(() => {
    if (this.wide()) return 'wide';
    return this.medium() ? 'medium' : 'narrow';
  });
  private readonly narrow = computed(() => this.layout() === 'narrow');
  protected readonly tabBarClass = computed(() =>
    this.narrow() ? 'ui-editor-bar ui-editor-bar--bottom' : 'ui-tabs',
  );
  protected readonly tabClass = computed(() =>
    this.narrow() ? 'ui-tab ui-tab--stacked' : 'ui-tab',
  );

  private readonly selectedTab = signal<EditorTab>('content');
  /** The chosen tab, or the layout's own default when that tab is not in it. */
  protected readonly activeTab = computed<EditorTab>(() => {
    const tabs = TABS_BY_LAYOUT[this.layout()];
    const selected = this.selectedTab();
    if (tabs.includes(selected)) return selected;
    return tabs.includes('content') ? 'content' : tabs[0];
  });
  /** The layout's tabs; only the active one is a Tab stop and names its panel (the only one shown). */
  protected readonly tabs = computed(() => {
    const active = this.activeTab();
    return TABS_BY_LAYOUT[this.layout()].map((id) => ({
      ...TAB_OPTIONS[id],
      selected: id === active,
      tabIndex: id === active ? 0 : -1,
      controls: id === active ? `editor-panel-${id}` : null,
    }));
  });
  protected readonly inspectorTab = computed(() => {
    const tab = this.activeTab();
    return isInspectorTab(tab) ? tab : null;
  });
  protected readonly showContent = computed(
    () => this.layout() === 'wide' || this.activeTab() === 'content',
  );
  protected readonly showPreview = computed(() => !this.narrow() || this.activeTab() === 'preview');
  protected readonly contentPanel = computed(() =>
    panelSemantics('content', this.layout() !== 'wide'),
  );
  protected readonly previewPanel = computed(() => panelSemantics('preview', this.narrow()));

  protected readonly previewMode = signal<PreviewMode>('auto');
  /** 'auto' shows the billet in its own colour mode, as the recipient would see it. */
  protected readonly previewViewMode = computed(() => {
    const mode = this.previewMode();
    return mode === 'auto' ? undefined : mode;
  });

  /** The slug as a string, so the 3D model is fetched again only when it really changes. */
  private readonly modelSlug = computed(() => {
    const { scene } = this.model();
    return scene.enabled ? scene.modelSlug : undefined;
  });
  private readonly assetRequest = resource({
    params: () => this.modelSlug(),
    loader: ({ params }) => this.catalog.get(params),
  });
  protected readonly asset = computed(() =>
    this.assetRequest.hasValue() ? this.assetRequest.value() : null,
  );

  /** The breadcrumb names the billet by its title, live while it is typed. */
  private readonly crumbLabel = computed(
    () => this.model().title.trim() || this.translate.instant('BREADCRUMB.EDIT_BILLET'),
  );

  private readonly preview = viewChild(PreviewFrame);

  constructor() {
    afterNextRender(() => this.nameCrumb());

    this.store.changedElsewhere.pipe(takeUntilDestroyed()).subscribe((localId) => {
      if (this.found() && (localId === null || localId === this.localId())) {
        this.onChangedElsewhere();
      }
    });
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const localId = params.get('localId') ?? '';
      if (localId !== this.localId()) this.open(localId);
    });
  }

  /** EditorCommands: one undo step, autosaved like any edit. */
  commit(update: (document: BilletDocument) => BilletDocument): void {
    this.history.commit(update);
  }

  protected undo(): void {
    this.step('undo');
  }

  protected redo(): void {
    this.step('redo');
  }

  /** The app's history answers Ctrl/Cmd+Z and friends everywhere in the editor, text fields too. */
  protected onShortcut(event: Event, action: HistoryAction | null): void {
    if (!action) return;
    event.preventDefault();
    this.step(action);
  }

  /**
   * A step that reorders blocks moves their cards in the DOM, which takes the focus away from a
   * field inside them; it goes back to that field, so the next Ctrl+Z still reaches the editor.
   */
  private step(action: HistoryAction): void {
    const focused = document.activeElement;
    this.history[action]();
    if (!(focused instanceof HTMLElement) || !this.host.contains(focused)) return;
    afterNextRender(
      () => {
        if (focused.isConnected && !this.host.contains(document.activeElement)) focused.focus();
      },
      { injector: this.injector },
    );
  }

  protected replay(): void {
    if (this.narrow()) this.selectTab('preview');
    this.preview()?.replay();
  }

  protected selectTab(tab: EditorTab): void {
    if (tab === this.activeTab()) return;
    this.selectedTab.set(tab);
    // A tab opens at its top, not where the one before was scrolled to (its column keeps scrolling,
    // or on a phone the page does).
    afterNextRender(
      () => {
        const panel = this.host.querySelector<HTMLElement>(`#editor-panel-${tab}`);
        if (!panel) return;
        panel.scrollTop = 0;
        if (panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: 'start' });
      },
      { injector: this.injector },
    );
  }

  /** Arrow keys, Home and End move between the tabs (WAI-ARIA tabs, automatic activation). */
  protected onTabKeydown(event: KeyboardEvent): void {
    const tabs = TABS_BY_LAYOUT[this.layout()];
    const index = tabs.indexOf(this.activeTab());
    const targets: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    const target = targets[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const tab = tabs[(target + tabs.length) % tabs.length];
    this.selectTab(tab);
    afterNextRender(() => this.host.querySelector<HTMLElement>(`#editor-tab-${tab}`)?.focus(), {
      injector: this.injector,
    });
  }

  /** Asked by the route's canDeactivate: the pending edit is written; only a failed write asks. */
  confirmLeave(): boolean | Promise<boolean> {
    if (!this.found() || this.autosave.flush()) return true;
    return this.confirmation.askConfirmation({
      title: this.translate.instant('FORMS.UNSAVED_TITLE'),
      message: this.translate.instant('EDITOR.LEAVE_UNSAVED'),
      confirmLabel: this.translate.instant('FORMS.UNSAVED_DISCARD'),
      cancelLabel: this.translate.instant('FORMS.UNSAVED_STAY'),
      confirmVariant: 'danger',
    });
  }

  /** Takes over another tab's version (dropping this tab's history). */
  protected loadTheirs(): void {
    const theirs = this.store.load(this.localId());
    if (theirs) this.adopt(theirs);
    this.afterNotice();
  }

  /** Keeps this tab's version and writes it, over another tab's change or removal. */
  protected keepMine(): void {
    this.remote.set(null);
    this.autosave.paused.set(false);
    this.autosave.flush(true);
    this.afterNotice();
  }

  /** The notice goes away with the button just pressed: the focus goes to the billet's title. */
  private afterNotice(): void {
    afterNextRender(
      () => {
        if (!this.host.contains(document.activeElement)) {
          this.host.querySelector<HTMLElement>('#editor-title')?.focus();
        }
      },
      { injector: this.injector },
    );
  }

  /**
   * Another tab saved or removed this billet. Without edits here its version is taken over; with
   * edits, autosave holds and the user decides.
   */
  private onChangedElsewhere(): void {
    const theirs = this.store.load(this.localId());
    if (theirs !== null && JSON.stringify(theirs) === JSON.stringify(this.model())) {
      this.remote.set(null);
      this.autosave.paused.set(false);
    } else if (theirs !== null && this.saveStatus() === 'saved' && this.remote() === null) {
      this.adopt(theirs);
    } else {
      this.remote.set(theirs === null ? 'removed' : 'changed');
      this.autosave.paused.set(true);
    }
  }

  private adopt(document: BilletDocument): void {
    this.model.set(document);
    this.history.reset();
    this.autosave.markSaved(document);
    this.remote.set(null);
    this.autosave.paused.set(false);
  }

  /** The route's localId changed while this editor stayed: save the old billet, open the new. */
  private open(localId: string): void {
    this.autosave.flush();
    const document = this.store.load(localId);
    this.localId.set(localId);
    this.found.set(document !== null);
    if (document) this.adopt(document);
    afterNextRender(() => this.nameCrumb(), { injector: this.injector });
  }

  /** Runs after the navigation has ended, which forgets the breadcrumb's labels. */
  private nameCrumb(): void {
    if (this.found()) this.breadcrumb.setDynamicLabel(this.crumbLabel);
  }
}
