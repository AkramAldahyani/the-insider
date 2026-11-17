/** Numbers the server and the client must agree on. */

/** Port of the game server (Colyseus). */
export const SERVER_PORT = 2567;
/** Port of the web page in development (Vite). */
export const CLIENT_PORT = 5173;
/** Name of the Colyseus room type. */
export const ROOM_NAME = 'office';

/** The server moves players and the clock this many times per second. */
export const TICK_RATE = 20;
/** Walking speed in map pixels per second. */
export const PLAYER_SPEED = 170;
/** Half the width of a player's square collision box, in pixels. */
export const PLAYER_RADIUS = 10;
/** How close (pixels) a player must be to a desk's chair to sit down. */
export const INTERACT_DISTANCE = 44;
/** How close (pixels) a player must be to a doorway to tap a badge on its reader. */
export const TAP_DISTANCE = 40;
/** How many recorded pictures per camera the monitors list (the newest ones). */
export const MONITOR_SHOTS = 400;
/** The company's reputation drops by this much each time an innocent person is fired. */
export const REPUTATION_PER_FIRING = 25;
/** How close (pixels) a player must be to the emergency button to press it. */
export const BUTTON_DISTANCE = 44;
/** At most one security-alert banner per this much game time, however many alerts fire. */
export const ALERT_BANNER_GAP_MS = 60_000;
/** How long the hacker must hold still at a PC to use the USB stick (real milliseconds). */
export const USB_HOLD_MS = 5000;
/** Shoulder surfing: how far behind a seated person's chair the watcher may stand (pixels, below the chair). */
export const SURF_BEHIND = 52;
/** ...and how far to the side of it. */
export const SURF_SIDE = 32;
/** A granted badge tap holds the door open this long (real milliseconds). */
export const DOOR_OPEN_MS = 3000;
/** A refused badge makes the reader flash red this long (real milliseconds). */
export const DOOR_DENIED_MS = 1500;
/** A door without a reader stays open this long after the last person left its doorway. */
export const AUTO_DOOR_HOLD_MS = 800;
