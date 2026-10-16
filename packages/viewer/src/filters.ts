import type { TownModel } from "@medieval-code/model";
import { defaultFilters, LEGEND, type FilterState } from "./interaction.js";

export function setupFilters(
  model: TownModel,
  onChange: (f: FilterState) => void,
): FilterState {
  const state = defaultFilters(model);

  const langEl = document.getElementById("lang-filters")!;
  const typeEl = document.getElementById("type-filters")!;
  const distEl = document.getElementById("district-filters")!;
  const searchEl = document.getElementById("search") as HTMLInputElement;
  const legendEl = document.getElementById("legend-list")!;

  function chip(parent: HTMLElement, label: string, set: Set<string>, value: string) {
    const el = document.createElement("span");
    el.className = "chip active";
    el.textContent = label;
    el.onclick = () => {
      if (set.has(value)) {
        set.delete(value);
        el.classList.remove("active");
        el.classList.add("inactive");
      } else {
        set.add(value);
        el.classList.add("active");
        el.classList.remove("inactive");
      }
      onChange(state);
    };
    parent.appendChild(el);
  }

  for (const lang of state.languages) chip(langEl, lang, state.languages, lang);
  for (const type of state.types) chip(typeEl, type, state.types, type);

  for (const d of model.districts) {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.onchange = () => {
      if (cb.checked) state.districts.add(d.id);
      else state.districts.delete(d.id);
      onChange(state);
    };
    label.appendChild(cb);
    label.appendChild(document.createTextNode(` ${d.path} (${d.neighborhoods.length})`));
    distEl.appendChild(label);
  }

  searchEl.oninput = () => {
    state.search = searchEl.value;
    onChange(state);
  };

  for (const [, color, name, desc] of LEGEND) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="swatch" style="background:${color}"></span><span><b>${name}</b> — ${desc}</span>`;
    legendEl.appendChild(li);
  }

  return state;
}
