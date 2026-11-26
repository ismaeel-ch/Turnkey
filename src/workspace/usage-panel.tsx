/*
 * Spend: what live model calls have cost. Two numbers: today's spend on the server against the daily cap that stops
 * Live when reached (from /api/health), and what the agents in view have used this session, from the `usage` events
 * their runs streamed. Loaded with the agent panel's Activity tab, not with the page.
 */
import { useEffect, useState } from 'react';
import { ProgressBar, Text, makeStyles, tokens } from '@fluentui/react-components';
import type { UsageSum } from '@/shared/types/workspace';
import { health, type Health } from '@/platform/model-client';
import { cacheRate, fmtTokens, fmtUsd, promptTokens } from '@/platform/agui/usage';

const useStyles = makeStyles({
  box: {
    display: 'grid',
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingVerticalS + ' ' + tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusMedium,
    border: '1px solid ' + tokens.colorNeutralStroke2,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  row: { display: 'flex', alignItems: 'baseline', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
  grow: { flexGrow: 1 },
  sub: { color: tokens.colorNeutralForeground3, display: 'block' },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: tokens.spacingHorizontalS,
    marginTop: tokens.spacingVerticalXS,
  },
  stat: { display: 'grid', gap: '2px', minWidth: 0 },
});

type Today = NonNullable<Health['today']>;

/** Today's spend and cap from the server; asked again whenever `calls` changes (a model call ended). */
function useToday(calls: number): { today: Today | null; live: boolean | null } {
  const [state, setState] = useState<{ today: Today | null; live: boolean | null }>({ today: null, live: null });
  useEffect(() => {
    let gone = false;
    const t = setTimeout(
      () =>
        void health().then((h) => {
          if (gone || !h) return;
          const d = h.today;
          const ok = d && Number.isFinite(d.spentUsd) && Number.isFinite(d.capUsd) && d.capUsd > 0;
          setState({ today: ok ? { spentUsd: Math.max(0, d.spentUsd), capUsd: d.capUsd } : null, live: !!h.live });
        }),
      calls ? 800 : 0, // after a call, wait a moment so a burst of calls asks once
    );
    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, [calls]);
  return state;
}

export default function UsagePanel({ usage, scope }: { usage: UsageSum; scope: string }) {
  const c = useStyles();
  const { today, live } = useToday(usage.calls);
  const share = today ? Math.min(1, today.spentUsd / today.capUsd) : 0;
  const rate = cacheRate(usage);
  const stat = (label: string, value: string) => (
    <div className={c.stat}>
      <Text size={100} className={c.sub}>
        {label}
      </Text>
      <Text weight="semibold">{value}</Text>
    </div>
  );
  return (
    <div className={'act-usage ' + c.box} data-calls={usage.calls} data-cost={usage.costUsd.toFixed(6)}>
      <div className={c.row}>
        <Text weight="semibold" className={c.grow}>
          Spent today
        </Text>
        <Text className="act-usage-today">
          {today ? fmtUsd(today.spentUsd) + ' of ' + fmtUsd(today.capUsd) : live === false ? 'No model connected' : '…'}
        </Text>
      </div>
      {today && (
        <ProgressBar
          value={share}
          max={1}
          thickness="large"
          color={share >= 0.9 ? 'error' : share >= 0.7 ? 'warning' : 'brand'}
          aria-label={'Spent today: ' + fmtUsd(today.spentUsd) + ' of the ' + fmtUsd(today.capUsd) + ' daily cap'}
        />
      )}
      <Text size={200} className={c.sub}>
        {live === false
          ? 'Nothing is spent: saved builds replay without calling a model.'
          : 'Live stops for everyone when the daily cap is reached and starts again at midnight UTC. Saved builds always work.'}
      </Text>
      <div className={c.stats}>
        {stat(scope, usage.calls ? (usage.estimated ? '~' : '') + fmtUsd(usage.costUsd) : '$0')}
        {stat('Model calls', String(usage.calls))}
        {stat('Tokens', fmtTokens(promptTokens(usage) + usage.output))}
        {stat('From cache', rate === null ? '–' : Math.round(rate * 100) + '%')}
      </div>
    </div>
  );
}
