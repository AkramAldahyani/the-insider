/**
 * The defender roles of DESIGN.md section 7, as game data.
 *
 * A player's role comes from the scenario (`players[].role`): it follows the
 * job (the sysadmin IS the system administrator). The hacker is not a role
 * here: the hacker is secretly one of the employees (see mission/mission.ts)
 * and keeps that employee's role as a disguise.
 *
 * `abilities` is what the onboarding card tells the player (plain text: no markup). Some abilities
 * are implemented in later parts of Phase 5; their text says what the role
 * will be able to do.
 */
export type RoleId = 'employee' | 'sysadmin' | 'soc' | 'guard' | 'helpdesk';

export interface RoleInfo {
  id: RoleId;
  /** Shown on the card: "SOC analyst". */
  title: string;
  /** What this role can do that others cannot, in a few short lines. */
  abilities: string[];
}

export const ROLES: Record<RoleId, RoleInfo> = {
  employee: {
    id: 'employee',
    title: 'Employee',
    abilities: [
      'Do your job tasks.',
      'Investigate your own PC: your logs (auth.log, syslog, dmesg), last, ps aux, ss -tnp, your .bash_history.',
      'Report what you find at meetings and vote.',
    ],
  },
  sysadmin: {
    id: 'sysadmin',
    title: 'System administrator',
    abilities: [
      'You hold the admin credentials: sudo on every machine, and the logs of all servers.',
      'You are the hacker\'s favourite target. Lock your screen.',
    ],
  },
  soc: {
    id: 'soc',
    title: 'SOC analyst',
    abilities: [
      'You read the network and security logs: proxy, DNS, mail and auth logs on ADMIN-SRV-01, the alert log on SEC-SRV-01.',
      'The SIEM search across all logs is yours.',
    ],
  },
  guard: {
    id: 'guard',
    title: 'Security guard',
    abilities: [
      'You read the badge, door and camera logs on SEC-SRV-01; the camera viewer is in the security office.',
      'You can detain someone caught in the act. Right: the defenders win. Wrong: you lose this power.',
    ],
  },
  helpdesk: {
    id: 'helpdesk',
    title: 'IT helpdesk',
    abilities: [
      'You can reset an employee\'s password.',
      'You can lock any PC\'s screen remotely.',
    ],
  },
};

export const ROLE_IDS = Object.keys(ROLES) as RoleId[];

/** A player's role (unknown values count as an ordinary employee). */
export function roleOf(role: string | undefined): RoleInfo {
  return ROLES[(role ?? 'employee') as RoleId] ?? ROLES.employee;
}
