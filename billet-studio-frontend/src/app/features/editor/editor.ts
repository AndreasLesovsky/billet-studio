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
import { form } from '@angular/forms/signals';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { createDocument, type BilletDocument } from '../../billet/billet-document';
import { resolveBilletMode } from '../../billet/view/billet-view-style';
import { mediaQuery, PREFERS_DARK } from '../../billet/view/media-query';
import { AssetCatalogApi } from '../../core/services/asset-catalog-api';
import { BreadcrumbService } from '../../shared/components/breadcrumb/breadcrumb-service';
import { ShareDialog } from '../../shared/components/share-dialog/share-dialog';
import type { ShareTarget } from '../../shared/components/share-dialog/share-state';
import { AccountEditorSession } from './account-editor-session';
import { EditorCommands } from './editor-commands';
import { EditorDeviceNotice } from './editor-device-notice';
import { createEditorHistory, historyShortcut, type HistoryAction } from './editor-history';
import { injectEditorLayout, type EditorLayout } from './editor-layout';
import { EditorMessage } from './editor-message';
import { EditorRemoteNotice } from './editor-remote-notice';
import { billetSchema } from './editor-schema';
import type { EditorHost, EditorSession, NoticeChoice } from './editor-session';
import { EditorSkeleton } from './editor-skeleton';
import { EditorToolbar } from './editor-toolbar';
import type { PreviewMode } from './editor-toolbar-options';
import { LocalEditorSession } from './local-editor-session';
import { ContentPanel } from './panels/content/content-panel';
import { EditorInspector, type InspectorTab } from './panels/editor-inspector';
import { PreviewFrame } from './preview-frame/preview-frame';

type EditorTab = 'preview' | 'content' | InspectorTab;

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
 * The billet editor: /billets/local/:localId/edit for a billet on this device, /billets/:id/edit
 * for one in the account. Its chrome is Studio like the rest of the site; the billet's theme shows
 * only in the preview (and on the published page). The form model IS the document: every edit
 * lands in `model`, the history takes it in, the session saves it where the billet lives and the
 * preview shows it. Panels bind `billetForm` and ask for bigger steps through EditorCommands. No
 * <form> wraps them: the form spans every panel, autosaves and never submits.
 */
@Component({
  selector: 'app-editor',
  imports: [
    ContentPanel,
    EditorDeviceNotice,
    EditorInspector,
    EditorMessage,
    EditorRemoteNotice,
    EditorSkeleton,
    EditorToolbar,
    PreviewFrame,
    ShareDialog,
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
  private readonly route = inject(ActivatedRoute);
  private readonly catalog = inject(AssetCatalogApi);
  private readonly translate = inject(TranslateService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly injector = inject(Injector);
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;

  /** A placeholder until the session shows the billet (phase 'ready'). */
  readonly model = signal<BilletDocument>(createDocument({ lang: 'de' }));
  readonly billetForm = form(this.model, billetSchema);

  protected readonly history = createEditorHistory(this.model);
  protected readonly historyShortcut = historyShortcut;
  protected readonly canUndo = this.history.canUndo;
  protected readonly canRedo = this.history.canRedo;

  /** The breadcrumb names the billet by its title, live while it is typed. */
  private readonly crumbLabel = computed(
    () => this.model().title.trim() || this.translate.instant('BREADCRUMB.EDIT_BILLET'),
  );

  private readonly editorHost: EditorHost = {
    model: this.model,
    adopt: (document) => this.adopt(document),
    commit: (update) => this.commit(update),
  };
  /** Where the billet lives, chosen by the route: this device, or the account. */
  protected readonly local: LocalEditorSession | null = this.route.snapshot.paramMap.has('localId')
    ? new LocalEditorSession(this.editorHost)
    : null;
  protected readonly account: AccountEditorSession | null = this.local
    ? null
    : new AccountEditorSession(this.editorHost);
  protected readonly session: EditorSession = (this.local ?? this.account) as EditorSession;
  /** A signed-in user in a billet of this device: the banner that takes it into the account. */
  protected readonly deviceNotice = computed(() => this.local?.shareMode() === 'device');
  protected readonly missingTextKey = this.local
    ? 'EDITOR.NOT_FOUND_TEXT'
    : 'EDITOR.NOT_FOUND_ACCOUNT_TEXT';
  /** Where a guest's sign-in comes back to. */
  protected readonly returnUrl = computed(() => (this.local ? this.local.returnUrl() : null));
  /** An account billet's publish state, for the toolbar's badge. */
  protected readonly shareFacts = computed(() => this.account?.shareTarget.facts() ?? null);
  /** The share dialog's billet while it is open. */
  protected readonly sharing = signal<ShareTarget | null>(null);

  protected readonly layout = injectEditorLayout();
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
  private readonly systemDark = mediaQuery(PREFERS_DARK);
  /** The palette the preview shows; the design panel's theme cards show the same one. */
  protected readonly previewColorMode = computed(() =>
    resolveBilletMode(this.previewViewMode() ?? this.model().colorMode, this.systemDark()),
  );

  /**
   * The slug as a string, so the 3D model is fetched again only when it really changes - and only
   * for the billet itself, never for the placeholder shown while it loads.
   */
  private readonly modelSlug = computed(() => {
    const { scene } = this.model();
    return this.session.phase() === 'ready' && scene.enabled ? scene.modelSlug : undefined;
  });
  private readonly assetRequest = resource({
    params: () => this.modelSlug(),
    loader: ({ params }) => this.catalog.get(params),
  });
  protected readonly asset = computed(() =>
    this.assetRequest.hasValue() ? this.assetRequest.value() : null,
  );

  private readonly preview = viewChild(PreviewFrame);

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

  /**
   * The app's history answers Ctrl/Cmd+Z and friends everywhere in the editor, text fields too
   * (the toolbar's side sheet included) - not in the share dialog, which sits in the editor but
   * edits nothing.
   */
  protected onShortcut(event: Event, action: HistoryAction | null): void {
    if (!action || (event.target instanceof Element && event.target.closest('app-share-dialog'))) {
      return;
    }
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

  /** Asked by the route's canDeactivate: the session secures the pending edit, or asks. */
  confirmLeave(): boolean | Promise<boolean> {
    return this.session.confirmLeave();
  }

  protected async resolve(choice: NoticeChoice): Promise<void> {
    await this.session.resolve(choice);
    this.afterNotice();
  }

  protected takeOver(): void {
    void this.local?.takeOver();
  }

  protected reload(): void {
    if (this.account) this.account.reload();
  }

  protected openShare(): void {
    if (this.account) this.sharing.set(this.account.shareTarget);
  }

  /**
   * The notice goes away with the button just pressed: the focus goes to the billet's title (on a
   * phone, the toolbar's title button).
   */
  private afterNotice(): void {
    afterNextRender(
      () => {
        if (!this.host.contains(document.activeElement)) {
          this.host.querySelector<HTMLElement>('#editor-title, #editor-title-button')?.focus();
        }
      },
      { injector: this.injector },
    );
  }

  /**
   * The billet's new start: loaded, reloaded, or another tab's. Its title names the crumb, after
   * the render, because the navigation that got here forgets the breadcrumb's labels.
   */
  private adopt(document: BilletDocument): void {
    this.model.set(document);
    this.history.reset();
    afterNextRender(() => this.breadcrumb.setDynamicLabel(this.crumbLabel), {
      injector: this.injector,
    });
  }
}
