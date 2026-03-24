import "@hotwired/turbo-rails";
import "@shoelace-style/shoelace/dist/themes/light.css";
import "@shoelace-style/shoelace/dist/themes/dark.css";
import "../../assets/stylesheets/purisTheme-light.css";
import "@awesome.me/webawesome/dist/styles/webawesome.css";

import {
  setBasePath,
  SlButton,
  SlSelect,
  SlOption,
  SlRange,
  SlDropdown,
  SlMenu,
  SlMenuItem,
  SlIcon,
} from "@shoelace-style/shoelace";

import { PurisLogoType, PurisLogoMark } from "@puris/web-components";

// Import Web Awesome components and register them manually
import WaButton from "@awesome.me/webawesome/dist/components/button/button.js";
import WaIcon from "@awesome.me/webawesome/dist/components/icon/icon.js";
import WaBadge from "@awesome.me/webawesome/dist/components/badge/badge.js";
import WaTooltip from "@awesome.me/webawesome/dist/components/tooltip/tooltip.js";
import WaAnimation from "@awesome.me/webawesome/dist/components/animation/animation.js";

customElements.define("wa-button", WaButton);
customElements.define("wa-icon", WaIcon);
customElements.define("wa-badge", WaBadge);
customElements.define("wa-icon", WaIcon);
customElements.define("wa-tooltip", WaTooltip);
customElements.define("wa-animation", WaAnimation);
customElements.define("puris-logomark", PurisLogoMark);
customElements.define("puris-logotype", PurisLogoType);

setBasePath("/shoelace-assets");

import "../controllers";

import ePub from "epubjs";

window.ePub = ePub;

const applyTheme = () => {
  const savedTheme = localStorage.getItem("ui.theme") || "dark";
  const isLight = savedTheme === "light";

  document.documentElement.classList.toggle("puris-light", isLight);
  document.body?.classList.toggle("puris-light", isLight);
};

applyTheme();
document.addEventListener("turbo:load", applyTheme);
