/**
 * Tiny DOM helper so the UI stays framework-free. `h("div", {class: "x"}, [...])`
 * builds an element, sets attributes/handlers, and appends children.
 */

type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  text?: string;
  html?: string;
  [key: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) {
      continue;
    }
    if (key === "class") {
      el.className = String(value);
    } else if (key === "text") {
      el.textContent = String(value);
    } else if (key === "html") {
      el.innerHTML = String(value);
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    el.append(child);
  }
  return el;
}

/** Remove all children of a node. */
export function clear(node: Node): void {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}
