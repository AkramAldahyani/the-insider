# Playing with friends at home

One computer runs the game. Everybody else only needs a web browser (Chrome, Edge or Firefox) in the **same home network** (the same Wi-Fi or router). Nothing has to be installed on the other computers.

## On the computer that runs the game

1. Open a terminal in the project folder and start the game:

   ```powershell
   corepack pnpm start
   ```

   It builds the web page first (a few seconds) and then prints something like this:

   ```
   [insider] play on this computer:    http://localhost:2567
   [insider] other computers at home:  http://192.168.8.63:2567
   ```

2. The first time, Windows asks whether **Node.js** may use the network. Allow it for **private networks** only. (If you closed that window, see below.)
3. Open `http://localhost:2567`, type your name and press **Create a lobby**.
4. Send your friends the link shown in the lobby. It already contains the right address and the code.

Leave the terminal open while you play. `Ctrl+C` stops the game, and every match with it.

## On the other computers

Open the link, type a name, press **Join the lobby**, and then **I am ready**. That is all.

You can also open `http://192.168.8.63:2567` (the address your computer printed, yours will be different) and type the five letters of the code.

## When it does not work

| What you see | What to do |
|---|---|
| The page does not open on another computer | Are both in the same network? Guest Wi-Fi usually keeps computers apart. Then check the firewall (next row). |
| It opens on your computer only | Windows blocked it. Open *Windows Security*, *Firewall & network protection*, *Allow an app through firewall*, and tick **Node.js JavaScript Runtime** for *Private*. Your Wi-Fi must be set to *Private network* in the Windows network settings. |
| The printed address does not work | The computer has several network adapters (for example for virtual machines). The terminal prints the others in brackets: try those. |
| The link in the lobby begins with `localhost` | You started it with `pnpm dev`. That is for development, and only your own computer can connect. Use `pnpm start`. |
| *Port 2567 is in use* (`EADDRINUSE`) | The game is still running in another window. Stop it there, or use another port: `$env:GAME_PORT='2600'; corepack pnpm start` |
| *Too many tries. Wait a moment.* | Somebody tried many codes in a short time. Wait half a minute. |
| *Connection lost* | The page comes back by itself. Your place is kept for a minute; after that a bot plays until you return. |

## Is it safe?

- It is meant for a home network with people you know. **Do not open the port to the Internet** (no port forwarding in the router). An Internet server needs accounts and encryption; that is Phase 8 of the project.
- Connections inside your home are not encrypted (`http`, not `https`). There is nothing secret in them except who the hacker is.
- Nothing in the game runs real commands or touches real files. Other computers can ask the server for the files of the web page and for the game, and for nothing else.
- With `pnpm start` there is no developer panel. With `pnpm dev` there is one, so then only your own computer can connect.

## How many people?

The small office has 11 desks, so up to 11 people play in one lobby, and several lobbies can play at the same time. Measured on the development computer with `corepack pnpm load`: with 30 people in three lobbies, and also with 55 in six, 95 % of all answers took 5 milliseconds or less.
