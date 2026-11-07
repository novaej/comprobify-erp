import { describe, expect, it } from 'vitest';
import { Dec } from '../kernel';
import { applyCost, type LevelState } from './cost';

const level = (onHand: string, value: string, averageCost: string): LevelState => ({
  onHand: new Dec(onHand),
  value: new Dec(value),
  averageCost: new Dec(averageCost),
});
const shown = (state: LevelState) => ({
  onHand: state.onHand.toString(),
  value: state.value.toFixed(6),
  averageCost: state.averageCost.toFixed(6),
});
const into = (quantity: string, unitCost: string) =>
  ({ direction: 'IN', quantity: new Dec(quantity), unitCost: new Dec(unitCost) }) as const;
const out = (quantity: string) => ({ direction: 'OUT', quantity: new Dec(quantity) }) as const;

// FR-INV-5, ADR-018.
describe('weighted average cost', () => {
  it('takes the first receipt at its cost', () => {
    const result = applyCost(level('0', '0', '0'), into('10', '2.50'));
    expect(shown(result.level)).toEqual({
      onHand: '10',
      value: '25.000000',
      averageCost: '2.500000',
    });
    expect(result.value.toFixed(6)).toBe('25.000000');
  });

  it('blends a receipt into what is on hand', () => {
    const result = applyCost(level('10', '25', '2.5'), into('30', '3.10'));
    // (25 + 93) / 40
    expect(shown(result.level)).toEqual({
      onHand: '40',
      value: '118.000000',
      averageCost: '2.950000',
    });
  });

  it('takes goods out at the average and leaves the average alone', () => {
    const result = applyCost(level('40', '118', '2.95'), out('15'));
    expect(shown(result.level)).toEqual({
      onHand: '25',
      value: '73.750000',
      averageCost: '2.950000',
    });
    expect(result.unitCost.toFixed(6)).toBe('2.950000');
    expect(result.value.toFixed(6)).toBe('-44.250000');
  });

  it('empties a level to exactly zero value, whatever the rounding left', () => {
    // Three units bought for 10.00: the average is 3.333333 and the value 10.
    const bought = applyCost(level('0', '0', '0'), into('3', '3.333333')).level;
    const after = applyCost({ ...bought, value: new Dec('10') }, out('2'));
    const last = applyCost(after.level, out('1'));
    expect(shown(last.level)).toEqual({ onHand: '0', value: '0.000000', averageCost: '3.333333' });
    expect(after.value.add(last.value).toFixed(6)).toBe('-10.000000');
  });

  it('settles a negative balance at the cost of the receipt that covers it', () => {
    // Allowed negative stock: 5 out at an average of 2, then 8 come in at 3.
    const short = applyCost(level('0', '0', '2'), out('5')).level;
    expect(shown(short)).toEqual({ onHand: '-5', value: '-10.000000', averageCost: '2.000000' });
    const result = applyCost(short, into('8', '3'));
    expect(shown(result.level)).toEqual({
      onHand: '3',
      value: '9.000000',
      averageCost: '3.000000',
    });
    // The movement records what the level's value actually changed by.
    expect(result.value.toFixed(6)).toBe('19.000000');
    expect(result.unitCost.toFixed(6)).toBe('3.000000');
  });

  it('refuses a quantity that is not positive', () => {
    expect(() => applyCost(level('1', '1', '1'), out('0'))).toThrow();
  });
});
