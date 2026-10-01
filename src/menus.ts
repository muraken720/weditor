/** Native disclosure menus with focus and keyboard handling. */
export function installMenus() {
  const menus = [...document.querySelectorAll<HTMLDetailsElement>(".menu")];
  function closeMenus(except?: HTMLDetailsElement) {
    for (const menu of menus) if (menu !== except) menu.open = false;
  }
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const menu = target?.closest<HTMLDetailsElement>(".menu") || undefined;
    closeMenus(menu);
    if (target?.closest(".menu-items button")) closeMenus();
  });
  document.addEventListener("focusin", (event) => {
    if (event.target instanceof Element && !event.target.closest(".menu"))
      closeMenus();
  });
  for (const menu of menus) {
    menu.addEventListener("keydown", (event) => {
      const summary = menu.querySelector("summary")!;
      const items = [
        ...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      ];
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        menu.open = false;
        summary.focus();
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        closeMenus(menu);
        menu.open = true;
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : event.key === "ArrowDown"
                ? (index + 1) % items.length
                : (index - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    });
  }
}
