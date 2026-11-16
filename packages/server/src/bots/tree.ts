/**
 * A very small behaviour tree.
 *
 * A behaviour tree is a way to write "what should this character do now?" as
 * a tree of small steps instead of one long if/else. DESIGN.md section 10
 * asks for it because the same building blocks will later describe the bot
 * hacker.
 *
 * Every node, when asked ("ticked"), answers one of three things:
 *   - "success": done;
 *   - "failure": cannot do this;
 *   - "running": busy with it, ask again next tick.
 *
 * Two nodes combine others:
 *   - sequence(a, b, c): do a, then b, then c. Stops at the first child that
 *     is not "success" and reports that child's answer. ("First a AND then b")
 *   - selector(a, b, c): try a; if it fails try b; and so on. Stops at the
 *     first child that is not "failure". ("a, OR ELSE b")
 *
 * The tree is ticked from the top every time, and it remembers nothing itself:
 * all memory lives in the bot's `Mind`. That is what lets a higher-priority
 * branch (it is break time) interrupt a lower one (working) at any moment.
 */
export type Status = 'success' | 'failure' | 'running';
export type Node<T> = (subject: T) => Status;

export function sequence<T>(...children: Node<T>[]): Node<T> {
  return (subject) => {
    for (const child of children) {
      const status = child(subject);
      if (status !== 'success') return status;
    }
    return 'success';
  };
}

export function selector<T>(...children: Node<T>[]): Node<T> {
  return (subject) => {
    for (const child of children) {
      const status = child(subject);
      if (status !== 'failure') return status;
    }
    return 'failure';
  };
}

/** A yes/no question as a node: success for yes, failure for no. */
export function condition<T>(test: (subject: T) => boolean): Node<T> {
  return (subject) => (test(subject) ? 'success' : 'failure');
}
