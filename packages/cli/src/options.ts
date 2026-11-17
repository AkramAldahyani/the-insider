import { ALL_WEAKNESSES, type WeaknessChoice, type WeaknessId } from '@insider/engine';

export interface MissionOptions {
  hacker?: string;
  weaknesses?: WeaknessChoice;
}

/** Mission settings are startup-only, so changing player never rerolls the office. */
export function missionOptions(args: string[]): MissionOptions {
  const value = (name: string): string | undefined => {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    const result = args[index + 1];
    if (!result?.trim() || result.startsWith('--')) throw new Error(`${name} needs a value.`);
    return result;
  };
  const hacker = value('--hacker');
  const vulns = value('--vulns');
  if (vulns === undefined) return { hacker };
  if (vulns === 'random') return { hacker, weaknesses: 'random' };
  if (vulns === 'none') return { hacker, weaknesses: [] };
  const ids = vulns.split(',').map((id) => id.trim());
  if (ids.some((id) => !ALL_WEAKNESSES.includes(id as WeaknessId))) {
    throw new Error(`--vulns expects random, none, or a comma-separated list of: ${ALL_WEAKNESSES.join(', ')}.`);
  }
  return { hacker, weaknesses: [...new Set(ids)] as WeaknessId[] };
}
