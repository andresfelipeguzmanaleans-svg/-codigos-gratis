import { useState, useMemo } from 'react';

interface Mutation {
  id: string;
  name: string;
  multiplier: number | { min: number; max: number };
}

interface Props {
  baseValue: number | null;
  weightMin: number | null;
  weightMax: number | null;
  baseWeight: number | null;
  mutations: Mutation[];
}

function getMult(m: Mutation): number {
  if (typeof m.multiplier === 'number') return m.multiplier;
  return m.multiplier.max;
}

function formatC(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString('en-US');
}

export default function FishValueCalc({ baseValue, weightMin, weightMax, baseWeight, mutations }: Props) {
  const bv = baseValue ?? 0;
  const wMin = weightMin ?? 0;
  const wMax = weightMax ?? 0;
  const bw = baseWeight ?? 0;
  const [weight, setWeight] = useState(bw.toString());
  const [mutationId, setMutationId] = useState('none');

  const sorted = useMemo(
    () => [...mutations].sort((a, b) => getMult(b) - getMult(a)),
    [mutations],
  );

  const w = parseFloat(weight) || 0;
  const mutation = sorted.find(m => m.id === mutationId);
  const mult = mutation ? getMult(mutation) : 1;
  const result = bv * w * mult;

  return (
    <div className="calc">
      <div className="calc__row">
        <label className="calc__label" htmlFor="calc-weight">Weight (kg)</label>
        <input
          id="calc-weight"
          className="calc__input"
          type="number"
          min={wMin}
          max={wMax}
          step="0.1"
          value={weight}
          placeholder={`${wMin} - ${wMax}`}
          onChange={e => setWeight(e.target.value)}
        />
        <span className="calc__range">{wMin} – {wMax.toLocaleString('en-US')} kg</span>
      </div>

      <div className="calc__row">
        <label className="calc__label" htmlFor="calc-mutation">Mutation</label>
        <select
          id="calc-mutation"
          className="calc__select"
          value={mutationId}
          onChange={e => setMutationId(e.target.value)}
        >
          <option value="none">None (1x)</option>
          {sorted.map(m => (
            <option key={m.id} value={m.id}>
              {m.name} ({getMult(m)}x)
            </option>
          ))}
        </select>
      </div>

      <div className="calc__result">
        <span className="calc__result-label">Estimated Value</span>
        <span className="calc__result-value">
          {result > 0 ? `${formatC(result)} C$` : '—'}
        </span>
        {result > 0 && (
          <span className="calc__result-formula">
            {bv.toLocaleString('en-US')} C$/kg × {w.toLocaleString('en-US')} kg{mult > 1 ? ` × ${mult}x` : ''}
          </span>
        )}
      </div>
    </div>
  );
}
