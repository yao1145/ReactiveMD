import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  createReactConfig,
  createReactHost,
  defineReactComponent,
  defineReactComponentPackage,
  type LocalComponentContext,
} from 'reactive-md/react';
import componentCssText from './component.css?raw';
import { game2048 } from './manifest';
import {
  createGameState,
  move,
  tileTier,
  type Cell2048,
  type Direction2048,
  type Game2048State,
  type Game2048Status,
} from './game-engine';

/** Component CSS as text; the build inlines it for the SSR harness. */
export const componentCss = componentCssText;

interface Game2048Options {
  readonly size: number;
  readonly seed: number;
  readonly target: number;
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

function readOptions(context: LocalComponentContext): Game2048Options {
  return {
    size: numberProp(context, 'size', 4, 3, 6),
    seed: numberProp(context, 'seed', 7, 0, 99999),
    target: numberProp(context, 'target', 2048, 8, 131072),
  };
}

function readLabel(context: LocalComponentContext): string {
  const raw = context.props.label;
  return typeof raw === 'string' && raw.length > 0 ? raw : '2048';
}

function cellKey(cell: Cell2048): string {
  return `${cell.row}:${cell.column}`;
}

function BoardView(props: {
  readonly board: readonly (readonly number[])[];
  readonly label: string;
  readonly interactive: boolean;
  readonly tabIndex: number;
  readonly spawned?: readonly Cell2048[];
  readonly merged?: readonly Cell2048[];
  readonly onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const spawned = new Set((props.spawned ?? []).map(cellKey));
  const merged = new Set((props.merged ?? []).map(cellKey));
  return (
    <div
      className="rmd-2048-board"
      data-game-2048-board
      role="grid"
      aria-label={props.label}
      aria-rowcount={props.board.length}
      aria-colcount={props.board.length}
      aria-readonly={props.interactive ? undefined : true}
      tabIndex={props.tabIndex}
      onKeyDown={props.onKeyDown}
      style={{
        gridTemplateColumns: `repeat(${props.board.length}, minmax(0, 1fr))`,
        width: `calc(var(--rmd-2048-cell) * ${props.board.length} + var(--rmd-2048-gap) * ${props.board.length + 1})`,
      }}
    >
      {props.board.map((row, y) => (
        <div className="rmd-2048-row" role="row" key={y}>
          {row.map((value, x) => (
            <span
              key={x}
              className="rmd-2048-cell"
              role="gridcell"
              aria-label={value === 0 ? '' : String(value)}
              data-game-2048-cell
              data-value={value}
              data-tier={tileTier(value)}
              data-spawn={spawned.has(`${y}:${x}`) ? 'true' : undefined}
              data-merged={merged.has(`${y}:${x}`) ? 'true' : undefined}
            >
              {value === 0 ? null : <span className="rmd-2048-tile">{value}</span>}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function statusText(context: LocalComponentContext, status: Game2048Status): string {
  if (status === 'won') return context.locale.t('You win', '已达成');
  if (status === 'over') return context.locale.t('Game over', '已结束');
  return context.locale.t('Playing', '进行中');
}

export function Game2048(context: LocalComponentContext) {
  const options = readOptions(context);
  const label = readLabel(context);
  const debug = context.props.debug === true;
  const locked = context.disabled;

  const [game, setGame] = useState<Game2048State>(() => createGameState(options));
  const [exploded, setExploded] = useState(false);

  const signature = `${options.size}:${options.seed}:${options.target}`;
  const signatureRef = useRef(signature);
  useEffect(() => {
    if (signatureRef.current === signature) return;
    signatureRef.current = signature;
    setGame(createGameState(options));
  }, [signature, options.size, options.seed, options.target]);

  const resetRef = useRef(context.resetToken);
  useEffect(() => {
    if (resetRef.current === context.resetToken) return;
    resetRef.current = context.resetToken;
    setGame(createGameState(options));
  }, [context.resetToken, options.size, options.seed, options.target]);

  if (exploded) {
    throw new Error('2048 exploded during render');
  }

  const t = context.locale.t;
  const apply = (direction: Direction2048): void => {
    if (locked) return;
    setGame((previous) => move(previous, direction));
  };

  const resetGame = (): void => {
    context.runtime.reset(context.content);
    setGame(createGameState(options));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (locked) return;
    switch (event.key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        event.preventDefault();
        apply('left');
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        event.preventDefault();
        apply('right');
        break;
      case 'ArrowUp':
      case 'w':
      case 'W':
        event.preventDefault();
        apply('up');
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        event.preventDefault();
        apply('down');
        break;
      case 'r':
      case 'R':
        event.preventDefault();
        setGame(createGameState(options));
        break;
      default:
        break;
    }
  };

  return (
    <div
      className="rmd-2048"
      data-game-2048
      data-state={game.status}
      data-points={game.score}
      data-moves={game.moves}
    >
      <div className="rmd-2048-head">
        <strong className="rmd-2048-title">{label}</strong>
        <output className="rmd-2048-status" data-game-2048-status>
          {statusText(context, game.status)}
        </output>
      </div>
      <div className="rmd-2048-body">
        <BoardView
          board={game.board}
          interactive
          label={`${label}: ${t(
            'Use arrow keys or W A S D to move tiles, and R to restart.',
            '使用方向键或 W A S D 移动方块，R 重开。',
          )}`}
          tabIndex={locked ? -1 : 0}
          spawned={game.spawned}
          merged={game.merged}
          onKeyDown={onKeyDown}
        />
        <aside className="rmd-2048-side" aria-label={t('Game information', '游戏信息')}>
          <dl className="rmd-2048-stats">
            <div>
              <dt>{t('Score', '得分')}</dt>
              <dd data-game-2048-score>{game.score}</dd>
            </div>
            <div>
              <dt>{t('Moves', '步数')}</dt>
              <dd data-game-2048-moves>{game.moves}</dd>
            </div>
            <div>
              <dt>{t('Target', '目标')}</dt>
              <dd data-game-2048-target>{game.target}</dd>
            </div>
          </dl>
          <div className="rmd-2048-controls">
            <button type="button" data-game-2048-left disabled={locked} onClick={() => apply('left')} aria-label={t('Move left', '左移')}>←</button>
            <button type="button" data-game-2048-up disabled={locked} onClick={() => apply('up')} aria-label={t('Move up', '上移')}>↑</button>
            <button type="button" data-game-2048-right disabled={locked} onClick={() => apply('right')} aria-label={t('Move right', '右移')}>→</button>
            <button type="button" data-game-2048-down disabled={locked} onClick={() => apply('down')} aria-label={t('Move down', '下移')}>↓</button>
            <button type="button" data-game-2048-new disabled={locked} onClick={() => setGame(createGameState(options))}>
              {t('New', '新局')}
            </button>
            <button type="button" data-game-2048-reset onClick={resetGame}>{t('Reset', '重置')}</button>
            {debug ? (
              <button type="button" data-game-2048-break onClick={() => setExploded(true)}>
                {t('Break', '模拟错误')}
              </button>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function Game2048Static(context: LocalComponentContext) {
  const options = readOptions(context);
  const label = readLabel(context);
  const initial = createGameState(options);
  const t = context.locale.t;
  return (
    <div className="rmd-2048 rmd-2048-static" data-game-2048-static data-state={initial.status}>
      <div className="rmd-2048-head">
        <strong className="rmd-2048-title">{label}</strong>
        <span className="rmd-2048-status">
          {options.size} × {options.size}
        </span>
      </div>
      <BoardView
        board={initial.board}
        interactive={false}
        label={`${label}: ${t('Static preview', '静态预览')}`}
        tabIndex={-1}
        spawned={initial.spawned}
      />
      <p className="rmd-2048-static-note" data-game-2048-static-note>
        {t('Open the document in a browser to play.', '在浏览器中打开本文档即可游玩。')}
      </p>
    </div>
  );
}

/**
 * The component package is the authoring declaration consumed by every host.
 * Preview, authoring, SSR and offline export compose it once.
 */
export const game2048Package = defineReactComponentPackage({
  ...game2048,
  css: componentCss,
  render: Game2048,
  renderStatic: Game2048Static,
});

const game2048Host = createReactHost({ packages: [game2048Package] });

/** Compatibility exits derived from the package and its single host. */
export const game2048Implementation = game2048Package.components[0];
export const config = game2048Host.config;
export const reactConfig = game2048Host.reactConfig;

/**
 * Used only by the SSR error probe: the static implementation throws so the
 * pipeline must report `local.extension.ssr-render` instead of leaking.
 */
export const brokenReactConfig = createReactConfig(config, {
  components: [
    defineReactComponent(game2048, {
      render: Game2048,
      renderStatic: () => {
        throw new Error('2048 failed during server rendering');
      },
    }),
  ],
});
