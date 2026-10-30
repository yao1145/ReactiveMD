import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { LocalComponentContext } from '../react/component-api';
import {
  FieldError,
  LocalError,
  PrintValue,
  ToneProblem,
  accentStyle,
  boolAttr,
  itemText,
  localColor,
  rawAttr,
  textAttr,
  toneAttr,
  useComponentView,
  useResetToken,
  useValidationField,
  useWriter,
} from '../react/component-utils';

/* ------------------------------------------------------------------ layout */

export function PanelView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const { content, runtime, mode, t } = view;
  const title = textAttr(context, 'title', '');
  const resettable = boolAttr(context, 'reset', true);
  const showReset = resettable && mode !== 'static';
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    try {
      runtime.reset(content);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Cannot reset', '无法恢复默认'));
    }
  };

  return (
    <section className="local-panel" aria-label={title || t('Parameter panel', '参数面板')}>
      {title || showReset ? (
        <div className="local-panel-head">
          {title ? <h3 className="local-panel-title">{title}</h3> : <span />}
          {showReset ? (
            <button
              type="button"
              className="md-button md-button-quiet local-panel-reset"
              onClick={reset}
              aria-label={title ? t(`Reset ${title}`, `${title} 恢复默认`) : t('Reset', '恢复默认')}
            >
              {t('Reset', '恢复默认')}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="local-panel-body">{view.render()}</div>
      <FieldError message={error} />
    </section>
  );
}

export function CardView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const title = textAttr(context, 'title', '');
  return (
    <section className="md-card local-card">
      {title ? <h3 className="md-card-title">{title}</h3> : null}
      <div className="md-card-body">{view.render()}</div>
    </section>
  );
}

export function GridView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const columns = Math.min(4, Math.max(1, Math.floor(Number(context.props.columns ?? 2) || 2)));
  const style = { '--local-grid-columns': String(columns) } as CSSProperties;
  return (
    <div className="local-grid" style={style}>
      {view.render()}
    </div>
  );
}

export function TabView(context: LocalComponentContext) {
  const view = useComponentView(context);
  return <div className="local-tabpanel-body">{view.render()}</div>;
}

export function StepsTabView(context: LocalComponentContext) {
  return TabView(context);
}

export function OptionView() {
  return null;
}

export function ColumnView() {
  return null;
}

export function EdgeView() {
  return null;
}

export function TabsView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const domId = useId();
  const { content, mode, visible, t } = view;
  const { write, error } = useWriter(context);
  const label = textAttr(context, 'label', '');
  const validation = useValidationField(context);
  const tabs = content.children.filter(
    (child) => child.kind === 'component' && child.name === 'tab',
  );
  const values = tabs.map((tab, index) => rawAttr(tab, 'value') ?? `tab-${index + 1}`);
  const labels = tabs.map((tab, index) => itemText(context, tab, 'label', values[index]));
  const initial = rawAttr(content, 'initial') ?? values[0] ?? '';
  const bound = rawAttr(content, 'bind') !== undefined;
  const stored = context.runtime.get(content);
  const boundValue = typeof stored === 'string' ? stored : '';
  const [selected, setSelected] = useState(() => (values.includes(initial) ? initial : values[0] ?? ''));
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  useResetToken(context, () => {
    setSelected(values.includes(initial) ? initial : values[0] ?? '');
  });

  if (tabs.length === 0) {
    return <LocalError message={t('Tabs requires at least one tab', '标签页至少需要一个 tab')} />;
  }

  if (mode === 'static') {
    return (
      <section className="local-tabs local-static-tabs" aria-label={label || t('Tabs', '选项卡')}>
        {label ? <div className="local-tabs-label">{label}</div> : null}
        {tabs.map((tab, index) => (
          <section className="local-static-tab" key={tab.id}>
            <h4 className="local-static-tab-label">{labels[index]}</h4>
            <div className="local-static-tab-body">{view.render(tab.children, visible)}</div>
          </section>
        ))}
      </section>
    );
  }

  const current = bound
    ? values.includes(boundValue) ? boundValue : values[0]
    : values.includes(selected) ? selected : values[0];
  const activeIndex = Math.max(0, values.indexOf(current));

  const choose = (index: number) => {
    const value = values[index];
    if (value === undefined) return;
    if (bound) write(value);
    else setSelected(value);
    refs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next = -1;
    if (event.key === 'ArrowRight') next = (activeIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (activeIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    choose(next);
  };

  return (
    <section
      className="local-tabs"
      aria-label={label || t('Tabs', '选项卡')}
      aria-invalid={validation.invalid || undefined}
      aria-describedby={validation.describedBy}
    >
      {label ? <div className="local-tabs-label">{label}</div> : null}
      <div
        className="local-tablist"
        role="tablist"
        aria-label={label || t('Tabs', '选项卡')}
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab, index) => {
          const value = values[index];
          const active = value === current;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                refs.current[index] = element;
              }}
              id={`${domId}-tab-${index}`}
              type="button"
              role="tab"
              className={`local-tab${active ? ' is-selected' : ''}`}
              aria-selected={active}
              aria-controls={`${domId}-panel-${index}`}
              tabIndex={active ? 0 : -1}
              onClick={() => {
                if (bound) write(value);
                else setSelected(value);
              }}
            >
              {labels[index]}
            </button>
          );
        })}
      </div>
      {tabs.map((tab, index) => {
        const value = values[index];
        const active = value === current;
        return (
          <div
            key={tab.id}
            id={`${domId}-panel-${index}`}
            className="local-tabpanel"
            role="tabpanel"
            aria-labelledby={`${domId}-tab-${index}`}
            tabIndex={0}
            hidden={!active}
          >
            <PrintValue block value={labels[index]} />
            {view.render(tab.children, visible && active)}
          </div>
        );
      })}
      <FieldError message={error} />
    </section>
  );
}

export function StepsView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const domId = useId();
  const { content, mode, visible, t } = view;
  const { write, error, setError } = useWriter(context);
  const label = textAttr(context, 'label', '');
  const validation = useValidationField(context);
  const steps = content.children.filter(
    (child) => child.kind === 'component' && child.name === 'step',
  );
  const values = steps.map((step, index) => rawAttr(step, 'value') ?? `step-${index + 1}`);
  const labels = steps.map((step, index) => itemText(context, step, 'label', values[index]));
  const initial = rawAttr(content, 'initial') ?? '';
  const first = values.includes(initial) ? initial : values[0] ?? '';
  const stored = context.runtime.get(content);
  const boundValue = typeof stored === 'string' ? stored : '';
  const panelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const focusAfterNavigation = useRef(false);

  useResetToken(context, () => {
    setError(null);
    focusAfterNavigation.current = false;
  });

  const current = values.includes(boundValue) ? boundValue : first;
  const activeIndex = Math.max(0, values.indexOf(current));

  useEffect(() => {
    if (!focusAfterNavigation.current) return;
    focusAfterNavigation.current = false;
    panelRefs.current[activeIndex]?.focus({ preventScroll: true });
  }, [activeIndex, current]);

  if (steps.length === 0) {
    return <LocalError message={t('Steps requires at least one step', '步骤至少需要一个 step')} />;
  }

  if (mode === 'static') {
    const active = steps[activeIndex];
    return (
      <section className="local-steps local-static-steps" aria-label={label || t('Steps', '步骤')}>
        {label ? <div className="local-steps-label">{label}</div> : null}
        <div className="local-steps-nav local-static-steps-nav">
          <span className="local-steps-status" role="status" aria-live="polite">
            {t(`Step ${activeIndex + 1} of ${steps.length}`, `第 ${activeIndex + 1} 步，共 ${steps.length} 步`)}
          </span>
        </div>
        <div className="local-steps-panel" role="group" aria-label={labels[activeIndex]}>
          {view.render(active.children, visible)}
        </div>
      </section>
    );
  }

  const go = (index: number) => {
    const value = values[index];
    if (value === undefined) return;
    focusAfterNavigation.current = true;
    write(value);
  };

  return (
    <section
      className="local-steps"
      aria-label={label || t('Steps', '步骤')}
      aria-invalid={validation.invalid || undefined}
      aria-describedby={validation.describedBy}
    >
      {label ? <div className="local-steps-label">{label}</div> : null}
      <div className="local-steps-nav">
        <button
          type="button"
          className="md-button md-button-secondary local-steps-prev"
          disabled={activeIndex <= 0}
          onClick={() => go(activeIndex - 1)}
        >
          {t('Previous', '上一步')}
        </button>
        <span className="local-steps-status" role="status" aria-live="polite">
          {t(`Step ${activeIndex + 1} of ${steps.length}`, `第 ${activeIndex + 1} 步，共 ${steps.length} 步`)}
        </span>
        <button
          type="button"
          className="md-button md-button-secondary local-steps-next"
          disabled={activeIndex >= steps.length - 1}
          onClick={() => go(activeIndex + 1)}
        >
          {t('Next', '下一步')}
        </button>
      </div>
      {steps.map((step, index) => {
        const active = index === activeIndex;
        return (
          <div
            key={step.id}
            id={`${domId}-step-${index}`}
            ref={(element) => {
              panelRefs.current[index] = element;
            }}
            className="local-steps-panel"
            role="group"
            aria-label={labels[index]}
            tabIndex={-1}
            hidden={!active}
          >
            {view.render(step.children, visible && active)}
          </div>
        );
      })}
      <FieldError message={error} />
    </section>
  );
}

export function StepView() {
  return null;
}

export function AccordionView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const label = textAttr(context, 'label', '');
  return (
    <div className="local-accordion" role="group" aria-label={label || view.t('Accordion', '折叠面板')}>
      {label ? <div className="local-accordion-label">{label}</div> : null}
      {view.render()}
    </div>
  );
}

export function DisclosureView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const domId = useId();
  const { content, mode, visible, t } = view;
  const label = textAttr(context, 'label', t('Details', '折叠内容'));
  const initialOpen = boolAttr(context, 'open', false);
  const [open, setOpen] = useState(initialOpen);

  useResetToken(context, () => {
    setOpen(initialOpen);
  });

  if (mode === 'static') {
    return (
      <section className="local-disclosure local-static-disclosure">
        <h3 className="local-disclosure-heading">{label}</h3>
        <div className="local-disclosure-panel">{view.render()}</div>
      </section>
    );
  }

  const triggerId = `${domId}-disclosure-trigger`;
  const panelId = `${domId}-disclosure-panel`;

  return (
    <div className="local-disclosure">
      <h3 className="local-disclosure-heading">
        <button
          id={triggerId}
          type="button"
          className="local-disclosure-trigger"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          <span className={`local-chevron${open ? ' is-open' : ''}`} aria-hidden="true">
            ▸
          </span>
          <span>{label}</span>
        </button>
        <PrintValue value={label} />
      </h3>
      <div
        id={panelId}
        className="local-disclosure-panel"
        role="region"
        aria-labelledby={triggerId}
        hidden={!open}
      >
        {view.render(undefined, visible && open)}
      </div>
    </div>
  );
}

export function IfView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const { content, t, visible } = view;
  const raw = rawAttr(content, 'when');
  const whenValue = context.props.when;
  const when = typeof whenValue === 'boolean' ? whenValue : false;
  const conditionError = raw !== undefined && typeof whenValue !== 'boolean';
  const container = useRef<HTMLDivElement>(null);
  const wasVisible = useRef(when);
  const hadFocus = useRef(false);

  useEffect(() => {
    if (wasVisible.current && !when) {
      if (hadFocus.current) {
        const target = container.current?.closest('.local-document') as HTMLElement | null;
        if (target) {
          target.tabIndex = -1;
          target.focus({ preventScroll: true });
        }
      }
      hadFocus.current = false;
    }
    wasVisible.current = when;
  }, [when]);

  return (
    <>
      {conditionError ? <LocalError message={t('Cannot compute', '无法计算')} /> : null}
      <div
        ref={container}
        className="local-if md-if"
        role="group"
        aria-label={t('Conditional content', '条件内容')}
        tabIndex={-1}
        hidden={!when}
        aria-hidden={!when}
        onFocus={() => {
          hadFocus.current = true;
        }}
        onBlur={(event) => {
          if (!container.current?.contains(event.relatedTarget as Node | null)) {
            hadFocus.current = false;
          }
        }}
      >
        {view.render(undefined, visible && when)}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- feedback */

export function AlertView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const title = textAttr(context, 'title', '');
  const { tone, error } = toneAttr(
    context,
    'tone',
    ['info', 'success', 'warning'] as const,
    'info',
  );
  const role = tone === 'warning' ? 'alert' : 'status';
  return (
    <>
      {error ? <ToneProblem message={view.t('Invalid tone; using the default style', '色调无效，已使用默认样式')} /> : null}
      <div className={`local-alert local-alert-${tone}`} role={role}>
        {title ? <div className="local-alert-title">{title}</div> : null}
        <div className="local-alert-body">{view.render()}</div>
      </div>
    </>
  );
}

export function BadgeView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const { tone, error } = toneAttr(
    context,
    'tone',
    ['neutral', 'success', 'warning'] as const,
    'neutral',
  );
  const color = localColor(view.content);
  return (
    <>
      {error ? <ToneProblem message={view.t('Invalid tone; using the default style', '色调无效，已使用默认样式')} /> : null}
      <span
        className={`md-badge md-badge-${tone} local-badge`}
        style={color ? { color } : undefined}
      >
        {view.renderInline()}
      </span>
    </>
  );
}

export function TooltipView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const domId = useId();
  const { mode, t } = view;
  const text = textAttr(context, 'text', t('Tooltip', '提示'));
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const bubbleId = `${domId}-tooltip`;

  useEffect(() => {
    const bubble = bubbleRef.current;
    const trigger = triggerRef.current;
    if (!open || mode === 'static' || !bubble || !trigger) return;
    const position = () => {
      const rect = bubble.getBoundingClientRect();
      const anchor = trigger.getBoundingClientRect();
      const gap = Number.parseFloat(getComputedStyle(bubble).getPropertyValue('--space-2')) || 8;
      const left = Math.max(8, Math.min(anchor.left, window.innerWidth - rect.width - 8));
      const above = anchor.top - rect.height - gap;
      const top = above >= 8 ? above : Math.max(8, Math.min(anchor.bottom + gap, window.innerHeight - rect.height - 8));
      bubble.style.left = `${left}px`;
      bubble.style.top = `${top}px`;
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, { capture: true, passive: true });
    const observer = new ResizeObserver(position);
    observer.observe(trigger);
    observer.observe(bubble);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      observer.disconnect();
    };
  }, [open, text, mode]);

  if (mode === 'static') {
    return (
      <span className="local-tooltip local-static-tooltip">
        <span className="local-tooltip-trigger">{view.renderInline()}</span>
        <span className="local-tooltip-bubble is-visible" role="note">
          {text}
        </span>
      </span>
    );
  }

  return (
    <span
      className="local-tooltip"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        className="local-tooltip-trigger"
        ref={triggerRef}
        tabIndex={0}
        aria-describedby={bubbleId}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {view.renderInline()}
      </span>
      <span
        id={bubbleId}
        ref={bubbleRef}
        role="tooltip"
        className={`local-tooltip-bubble${open ? ' is-visible' : ''}`}
      >
        {text}
      </span>
      <PrintValue value={text} />
    </span>
  );
}

/* ------------------------------------------------------ inline additions */

export function JumpView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const domId = useId();
  const { content, mode, t } = view;
  const feedbackId = `${domId}-jump-feedback`;
  const [message, setMessage] = useState<string | null>(null);
  const to = rawAttr(content, 'to') ?? '';
  const target = view.navigation.targetId(to);
  const appearance = rawAttr(content, 'appearance') === 'button' ? 'button' : 'link';
  const color = localColor(content);
  const href = target ? `#${target}` : '#';
  const allowed = target !== undefined && view.navigation.allowed(to);

  useResetToken(context, () => setMessage(null));

  if (mode === 'static') {
    if (allowed && target) {
      return (
        <a
          href={`#${target}`}
          className="local-jump local-jump-link local-jump-static"
          style={accentStyle(color)}
        >
          {view.renderInline()}
        </a>
      );
    }
    return (
      <span className="local-jump local-jump-static-blocked" style={accentStyle(color)}>
        {view.renderInline()}
      </span>
    );
  }

  const onJump = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!allowed || !target) {
      event.preventDefault();
      setMessage(
        target
          ? t('Jump is blocked by the host', '跳转已被主机策略阻止')
          : t('Jump target not found', '找不到跳转目标'),
      );
      return;
    }
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const result = view.navigation.jump(to);
    if (result === 'missing') {
      event.preventDefault();
      setMessage(t('Jump target not found', '找不到跳转目标'));
      return;
    }
    if (result === 'hidden') {
      event.preventDefault();
      setMessage(t('Jump target is hidden', '跳转目标当前隐藏'));
      return;
    }
    event.preventDefault();
    setMessage(null);
  };

  return (
    <>
      <a
        href={allowed ? href : '#'}
        className={`local-jump local-jump-${appearance}`}
        style={accentStyle(color)}
        data-local-target-missing={target ? undefined : 'true'}
        data-local-jump-blocked={target && !allowed ? 'true' : undefined}
        aria-describedby={message ? feedbackId : undefined}
        onClick={onJump}
      >
        {view.renderInline()}
      </a>
      {message ? (
        <span
          id={feedbackId}
          className="local-jump-feedback"
          role="status"
          aria-live="polite"
        >
          {message}
        </span>
      ) : null}
    </>
  );
}

export function AnchorView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const id = view.navigation.anchorId();
  if (!id) return null;
  return <span className="local-anchor" id={id} data-local-anchor="" />;
}

export function TextView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const color = localColor(view.content);
  return (
    <span className="local-text" style={color ? { color } : undefined}>
      {view.renderInline()}
    </span>
  );
}

export function SectionView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const color = localColor(view.content);
  return (
    <div className="local-section" style={color ? { color } : undefined}>
      {view.render()}
    </div>
  );
}

/* ------------------------------------------------------------- validation */

export function ValidationView(context: LocalComponentContext) {
  const view = useComponentView(context);
  const hint = context.validation.hintFor(context.content);
  if (!hint) return null;
  const failed = hint.failed || hint.error;
  const announce = view.visible && failed;
  return (
    <span
      id={hint.id}
      className="local-validation-hint"
      data-local-validation={hint.error ? 'error' : hint.failed ? 'failed' : 'passed'}
      role={announce ? 'status' : undefined}
      aria-live={announce ? 'polite' : undefined}
    >
      {failed ? hint.message : null}
    </span>
  );
}
