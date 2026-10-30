import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createLocalConfig } from 'reactive-md/sdk';
import {
  createReactConfig,
  defineReactComponent,
  type LocalComponentContext,
} from 'reactive-md/react';
import { defaultPreset } from 'reactive-md/presets/default';
import componentCssText from './component.css?raw';
import { tetris } from './manifests';
import {
  createTetrisState,
  hardDrop,
  previewCells,
  renderBoard,
  restart,
  rotate,
  shift,
  softDrop,
  tick,
  togglePause,
  type TetrisCell,
  type TetrisPiece,
  type TetrisState,
} from './tetris-engine';

/** Component CSS as text; the build inlines it for the SSR harness. */
export const componentCss = componentCssText;

interface TetrisOptions {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
}

function numberProp(
  context: LocalComponentContext,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = context.props[name];
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function readOptions(context: LocalComponentContext): TetrisOptions {
  return {
    width: numberProp(context, 'width', 10, 6, 14),
    height: numberProp(context, 'height', 20, 12, 24),
    seed: numberProp(context, 'seed', 7, 0, 99999),
  };
}

function readLabel(context: LocalComponentContext): string {
  const raw = context.props.label;
  return typeof raw === 'string' && raw.length > 0 ? raw : 'Tetris';
}

function BoardView(props: {
  readonly board: readonly (readonly TetrisCell[])[];
  readonly width: number;
  readonly interactive: boolean;
  readonly label: string;
  readonly tabIndex: number;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className="rmd-tetris-board"
      data-tetris-board
      role="grid"
      aria-label={props.label}
      aria-readonly={props.interactive ? undefined : true}
      tabIndex={props.tabIndex}
      onKeyDown={props.onKeyDown}
      style={{ gridTemplateColumns: `repeat(${props.width}, minmax(0, 1fr))` }}
    >
      {props.board.map((row, y) => (
        <div className="rmd-tetris-row" role="row" key={y}>
          {row.map((cell, x) => (
            <span
              key={x}
              className="rmd-tetris-cell"
              role="gridcell"
              aria-label={cell === null ? '' : cell}
              data-tetris-cell={cell ?? 'empty'}
              data-piece={cell ?? undefined}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function NextView(props: { readonly pieces: readonly TetrisPiece[] }) {
  return (
    <div className="rmd-tetris-next" aria-label="Next pieces">
      {props.pieces.map((piece, index) => (
        <span className="rmd-tetris-next-piece" data-next-piece={piece} key={`${piece}-${index}`}>
          {previewCells(piece).map((row, y) => (
            <span className="rmd-tetris-next-row" key={y}>
              {row.map((filled, x) => (
                <span className="rmd-tetris-next-cell" data-filled={filled ? 'true' : 'false'} key={x} />
              ))}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}

function statusText(context: LocalComponentContext, status: TetrisState['status']): string {
  if (status === 'playing') return context.locale.t('Playing', '进行中');
  if (status === 'paused') return context.locale.t('Paused', '已暂停');
  return context.locale.t('Game over', '已结束');
}

export function Tetris(context: LocalComponentContext) {
  const options = readOptions(context);
  const label = readLabel(context);
  const speed = numberProp(context, 'speed', 600, 100, 2000);
  const debug = context.props.debug === true;
  const locked = context.disabled;

  const [game, setGame] = useState<TetrisState>(() => createTetrisState(options));
  const [exploded, setExploded] = useState(false);

  const signature = `${options.width}:${options.height}:${options.seed}`;
  const signatureRef = useRef(signature);
  useEffect(() => {
    if (signatureRef.current === signature) return;
    signatureRef.current = signature;
    setGame(createTetrisState(options));
  }, [signature, options.width, options.height, options.seed]);

  const resetRef = useRef(context.resetToken);
  useEffect(() => {
    if (resetRef.current === context.resetToken) return;
    resetRef.current = context.resetToken;
    setGame(createTetrisState(options));
  }, [context.resetToken, options.width, options.height, options.seed]);

  useEffect(() => {
    if (locked || !context.visible || game.status !== 'playing') return;
    const timer = window.setInterval(() => setGame((previous) => tick(previous)), speed);
    return () => window.clearInterval(timer);
  }, [locked, context.visible, game.status, speed]);

  if (exploded) {
    throw new Error('tetris exploded during render');
  }

  const t = context.locale.t;
  const resetGame = (): void => {
    context.runtime.reset(context.content);
    setGame(createTetrisState(options));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (locked) return;
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        setGame((previous) => shift(previous, -1));
        break;
      case 'ArrowRight':
        event.preventDefault();
        setGame((previous) => shift(previous, 1));
        break;
      case 'ArrowDown':
        event.preventDefault();
        setGame((previous) => softDrop(previous));
        break;
      case 'ArrowUp':
      case 'x':
      case 'X':
        event.preventDefault();
        setGame((previous) => rotate(previous));
        break;
      case ' ':
        event.preventDefault();
        setGame((previous) => hardDrop(previous));
        break;
      case 'p':
      case 'P':
        event.preventDefault();
        setGame((previous) => togglePause(previous));
        break;
      case 'r':
      case 'R':
        event.preventDefault();
        setGame((previous) => restart(previous));
        break;
      default:
        break;
    }
  };

  const board = renderBoard(game);
  const paused = game.status === 'paused';

  return (
    <div
      className="rmd-tetris"
      data-tetris
      data-tetris-state={game.status}
      data-tetris-points={game.score}
      data-tetris-moves={game.moves}
      data-tetris-piece={game.active?.type ?? ''}
    >
      <div className="rmd-tetris-head">
        <strong className="rmd-tetris-title">{label}</strong>
        <output className="rmd-tetris-status" data-tetris-status>
          {statusText(context, game.status)}
        </output>
      </div>
      <div className="rmd-tetris-body">
        <BoardView
          board={board}
          width={options.width}
          interactive
          label={`${label}: ${t(
            'Use arrow keys, Space to drop, P to pause and R to restart.',
            '使用方向键，空格落底，P 暂停，R 重开。',
          )}`}
          tabIndex={locked ? -1 : 0}
          onKeyDown={onKeyDown}
        />
        <aside className="rmd-tetris-side" aria-label={t('Game information', '游戏信息')}>
          <dl className="rmd-tetris-stats">
            <div>
              <dt>{t('Score', '得分')}</dt>
              <dd data-tetris-score>{game.score}</dd>
            </div>
            <div>
              <dt>{t('Lines', '行数')}</dt>
              <dd data-tetris-lines>{game.lines}</dd>
            </div>
            <div>
              <dt>{t('Level', '等级')}</dt>
              <dd data-tetris-level>{game.level}</dd>
            </div>
          </dl>
          <div className="rmd-tetris-next-label">{t('Next', '下一个')}</div>
          <NextView pieces={game.queue.slice(0, 3)} />
          <div className="rmd-tetris-controls">
            <button type="button" data-tetris-left disabled={locked} onClick={() => setGame((previous) => shift(previous, -1))} aria-label={t('Move left', '左移')}>←</button>
            <button type="button" data-tetris-rotate disabled={locked} onClick={() => setGame((previous) => rotate(previous))} aria-label={t('Rotate', '旋转')}>↻</button>
            <button type="button" data-tetris-right disabled={locked} onClick={() => setGame((previous) => shift(previous, 1))} aria-label={t('Move right', '右移')}>→</button>
            <button type="button" data-tetris-down disabled={locked} onClick={() => setGame((previous) => softDrop(previous))} aria-label={t('Soft drop', '下移')}>↓</button>
            <button type="button" data-tetris-drop disabled={locked} onClick={() => setGame((previous) => hardDrop(previous))}>{t('Drop', '落底')}</button>
            <button type="button" data-tetris-pause disabled={locked} onClick={() => setGame((previous) => togglePause(previous))}>
              {paused ? t('Resume', '继续') : t('Pause', '暂停')}
            </button>
            <button type="button" data-tetris-new disabled={locked} onClick={() => setGame(createTetrisState(options))}>
              {t('New', '新局')}
            </button>
            <button type="button" data-tetris-reset onClick={resetGame}>{t('Reset', '重置')}</button>
            {debug ? (
              <button type="button" data-tetris-break onClick={() => setExploded(true)}>
                {t('Break', '模拟错误')}
              </button>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function TetrisStatic(context: LocalComponentContext) {
  const options = readOptions(context);
  const label = readLabel(context);
  const initial = createTetrisState(options);
  const board = renderBoard(initial);
  const t = context.locale.t;
  return (
    <div className="rmd-tetris rmd-tetris-static" data-tetris-static>
      <div className="rmd-tetris-head">
        <strong className="rmd-tetris-title">{label}</strong>
        <span className="rmd-tetris-status">
          {options.width} × {options.height}
        </span>
      </div>
      <BoardView
        board={board}
        width={options.width}
        interactive={false}
        label={`${label}: ${t('Static preview', '静态预览')}`}
        tabIndex={-1}
      />
      <p className="rmd-tetris-static-note" data-tetris-static-note>
        {t('Open the document in a browser to play.', '在浏览器中打开本文档即可游玩。')}
      </p>
    </div>
  );
}

export const tetrisImplementation = defineReactComponent(tetris, {
  render: Tetris,
  renderStatic: TetrisStatic,
});

export const config = createLocalConfig({
  presets: [defaultPreset],
  components: [tetris],
});

export const reactConfig = createReactConfig(config, {
  components: [tetrisImplementation],
});

/**
 * Used only by the SSR error probe: the static implementation throws so the
 * pipeline must report `local.extension.ssr-render` instead of leaking.
 */
export const brokenReactConfig = createReactConfig(config, {
  components: [
    defineReactComponent(tetris, {
      render: Tetris,
      renderStatic: () => {
        throw new Error('tetris failed during server rendering');
      },
    }),
  ],
});
