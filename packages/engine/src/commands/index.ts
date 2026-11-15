/**
 * Fills the command table. To add a new shell command: write a Handler in one
 * of the files in this folder (or a new file) and add it to an exported map.
 */
import { fileCommands } from './files';
import { helpCommands } from './help';
import { identityCommands } from './identity';
import { logCommands } from './logs';
import { netCommands } from './net';
import { privCommands, privPending } from './priv';
import { procCommands } from './procs';
import { remoteCommands, remotePending } from './remote';
import { sessionCommands } from './sessions';
import { commands, pendingHandlers } from './table';
import { textCommands } from './text';

Object.assign(
  commands,
  fileCommands, textCommands, identityCommands, sessionCommands, procCommands,
  netCommands, logCommands, remoteCommands, privCommands, helpCommands,
);
Object.assign(pendingHandlers, remotePending, privPending);

/** Names of every command the simulated shell understands. */
export const commandNames = (): string[] => Object.keys(commands).sort();
