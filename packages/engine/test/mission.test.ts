/**
 * Phase 4, part A: the match's secrets. Which weaknesses an office has today,
 * what each one changes in the simulated world, and the hacker's tools folder.
 */
import { describe, expect, it } from 'vitest';
import { ALL_WEAKNESSES, briefing, chooseWeaknesses, createWorld, setHacker, type WeaknessChoice } from '../src/index';
import { FLAG, PW, ROOT_PW, SERVER, Term, atDesk, fileOn, scenario, ssh } from './helpers';

const world = (weaknesses: WeaknessChoice, seed = 1) => createWorld(scenario, seed, { weaknesses });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('choosing weaknesses', () => {
  it('a plain world has none, and its server room door lets one person through per badge', () => {
    const w = createWorld(scenario, 1);
    expect(w.mission).toMatchObject({ hackers: [], weaknesses: [], extraSudoAccount: '', carelessPlayer: '', onePersonDoors: ['SRV-ROOM'], won: null });
    expect(w.mission.flag).toEqual({ host: SERVER, path: '/root/flag.txt' });
  });

  it('"random" switches on 2 to 4, decided by the seed alone', () => {
    const combos = new Set<string>();
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const picked = chooseWeaknesses(scenario, seed, 'random');
      expect(picked.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(picked.length, `seed ${seed}`).toBeLessThanOrEqual(4);
      expect(new Set(picked).size).toBe(picked.length);
      expect(chooseWeaknesses(scenario, seed, 'random')).toEqual(picked); // the same seed, the same office
      combos.add(picked.join('+'));
      for (const id of picked) seen.add(id);
    }
    expect(combos.size).toBeGreaterThanOrEqual(8); // routes cannot be memorised
    expect([...seen].sort()).toEqual([...ALL_WEAKNESSES].sort()); // every weakness turns up in some match
  });

  it('a list forces exactly those; a weakness the scenario does not describe cannot be chosen', () => {
    expect(world(['tailgate', 'extra-sudo']).mission.weaknesses).toEqual(['extra-sudo', 'tailgate']);
    const bare = clone(scenario);
    delete bare.mission!.plaintextPassword;
    expect(chooseWeaknesses(bare, 1, ['plaintext-password', 'tailgate'])).toEqual(['tailgate']);
    delete bare.mission;
    expect(createWorld(bare, 1, { weaknesses: 'random' }).mission).toMatchObject({ weaknesses: [], flag: null, onePersonDoors: [] });
  });

  it('weaknesses never change the simulated network: seed 1 keeps its addresses', () => {
    const w = world([...ALL_WEAKNESSES]);
    expect(w.hosts['FIN-LT-07'].ip).toBe('10.0.2.58');
    expect(w.hosts['IT-WS-02'].ip).toBe('10.0.2.119');
    expect(w.hosts['REC-PC-01'].ip).toBe('10.0.2.180');
  });

  it('a mission that names unknown things is refused', () => {
    const bad = clone(scenario);
    bad.mission!.extraSudo!.candidates.push('ghost');
    expect(() => createWorld(bad, 1)).toThrow('mission.extraSudo: unknown account "ghost"');
    const bad2 = clone(scenario);
    bad2.mission!.flagHost = 'NOWHERE';
    expect(() => createWorld(bad2, 1)).toThrow('mission: flagHost must be a host');
  });
});

describe('what each weakness changes', () => {
  it('weak-admin-password: the sysadmin really uses the easy password, everywhere', () => {
    const w = world(['weak-admin-password']);
    expect(w.credentials['k.nasser']).toEqual({ password: 'nexora2026', strength: 8 });
    const t = new Term(w, 'IT-WS-02', 'p5');
    t.type(PW['k.nasser']); // his usual password
    expect(t.last.screen).toBe('locked');
    t.type('nexora2026');
    expect(t.prompt).toBe('k.nasser@IT-WS-02:~$ ');
    // Without the weakness the usual one works.
    expect(atDesk(world([]), 'k.nasser').prompt).toBe('k.nasser@IT-WS-02:~$ ');
  });

  it('extra-sudo: one regular employee can use sudo on the server and on their own PC', () => {
    const w = world(['extra-sudo']);
    const lucky = w.mission.extraSudoAccount;
    expect(scenario.mission!.extraSudo!.candidates).toContain(lucky);
    const t = atDesk(w, lucky);
    expect(t.type('id')).toContain('(sudo)');
    ssh(t, lucky, SERVER);
    t.type('sudo cat /root/flag.txt');
    expect(t.type(PW[lucky])).toContain(FLAG);
    // /etc/group on the server shows it to anyone who looks.
    expect(fileOn(w, SERVER, '/etc/group')).toMatch(new RegExp(`^sudo:x:27:.*${lucky.replace('.', '\\.')}`, 'm'));

    // Somebody else cannot, and without the weakness neither can the lucky one.
    const other = scenario.mission!.extraSudo!.candidates.find((c) => c !== lucky)!;
    const o = atDesk(w, other);
    ssh(o, other, SERVER);
    o.type('sudo cat /root/flag.txt');
    expect(o.type(PW[other])).toContain('is not in the sudoers file');
    const plain = atDesk(world([]), lucky);
    expect(plain.type('id')).not.toContain('(sudo)');
  });

  it('plaintext-password: an old script on the shared folder contains the root password, and it works', () => {
    const w = world(['plaintext-password']);
    const t = atDesk(w, 's.alharbi');
    ssh(t, 's.alharbi', SERVER);
    expect(t.type('ls /srv/shared/old')).toBe('backup-2025.sh\n');
    expect(t.type('cat /srv/shared/old/backup-2025.sh')).toContain(`ROOT_PW='${ROOT_PW}'`);
    t.type('su');
    t.type(ROOT_PW);
    expect(t.prompt).toBe('root@ADMIN-SRV-01:/home/s.alharbi# ');
    expect(t.type('cat /root/flag.txt')).toContain(FLAG);
    // Without the weakness there is no such file.
    const plain = atDesk(world([]), 's.alharbi');
    ssh(plain, 's.alharbi', SERVER);
    expect(plain.type('ls /srv/shared/old')).toContain('No such file or directory');
  });

  it('careless-admin and tailgate are recorded for the server to act on', () => {
    expect(world(['careless-admin']).mission.carelessPlayer).toBe('p5');
    expect(world([]).mission.carelessPlayer).toBe('');
    expect(world(['tailgate']).mission.onePersonDoors).toEqual([]);
    expect(world(['careless-admin']).mission.onePersonDoors).toEqual(['SRV-ROOM']);
  });
});

describe('the hacker', () => {
  it('gets a hidden, private tools folder on their own PC', () => {
    const w = world([]);
    expect(setHacker(w, 'p4')).toBe(true); // Omar
    expect(w.mission.hackers[0]).toBe('p4');
    const omar = atDesk(w, 'o.farouk');
    expect(omar.type('ls')).not.toContain('.tools'); // hidden from a plain ls
    expect(omar.type('ls -a')).toContain('.tools');
    expect(omar.type('ls -ld .tools')).toMatch(/^drwx------ .* o\.farouk o\.farouk /);
    expect(omar.type('cat .tools/README')).toContain('Every tool leaves a trace');
    expect(omar.type('ls .tools')).toContain('loot');
    // Only on his own PC...
    expect(fileOn(w, 'FIN-LT-07', '/home/o.farouk/.tools/README')).toBe('');
    // ...and nobody else can look inside, except root.
    const khalid = atDesk(w, 'k.nasser');
    ssh(khalid, 'k.nasser', 'MKT-LT-11');
    expect(khalid.type('ls /home/o.farouk/.tools')).toContain('Permission denied');
    khalid.type('sudo ls /home/o.farouk/.tools');
    expect(khalid.type(PW['k.nasser'])).toContain('README');
  });

  it('a match has one hacker', () => {
    const w = world([]);
    expect(setHacker(w, 'p4')).toBe(true);
    expect(setHacker(w, 'p1')).toBe(false);
    expect(setHacker(w, 'p4')).toBe(true); // the same player again is fine
    expect(setHacker(w, 'nobody')).toBe(false);
    expect(w.mission.hackers[0]).toBe('p4');
    expect(fileOn(w, 'FIN-LT-07', '/home/s.alharbi/.tools/README')).toBe('');
  });

  it('the briefing gives the goal and rumours, never today\'s weaknesses', () => {
    const w = world(['extra-sudo', 'plaintext-password', 'weak-admin-password']);
    setHacker(w, 'p4');
    const b = briefing(w);
    expect(b.goal).toContain('/root/flag.txt');
    expect(b.toolsPath).toBe('/home/o.farouk/.tools');
    expect(b.rumours.length).toBeGreaterThanOrEqual(5);
    const text = JSON.stringify(b);
    for (const secret of [...ALL_WEAKNESSES, w.mission.extraSudoAccount, 'nexora2026', ROOT_PW, 'backup-2025']) expect(text.includes(secret), secret).toBe(false);
    // The same briefing whatever is switched on.
    const other = world([]);
    setHacker(other, 'p4');
    expect(briefing(other)).toEqual(b);
  });
});
