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
