import { Controller } from "@hotwired/stimulus";

export default class extends Controller<HTMLElement> {
  connect() {
    const dataTag = document.getElementById("h6idthing");
    console.log(dataTag);
    if (dataTag) {
      dataTag.style.fontWeight = "bold";
      dataTag.style.fontSize = "29px";
    }
  }

  changeTheme(event: any) {
    const value = event?.detail?.item?.value;
    if (value !== "light" && value !== "dark") return;

    localStorage.setItem("ui.theme", value);

    const isDark = value === "dark";
    document.documentElement.classList.toggle("sl-theme-dark", isDark);
    document.body?.classList.toggle("sl-theme-dark", isDark);

    // Update variant attribute for web components
    this.updateComponentVariants(isDark);

    console.log("Theme changed:", value);
  }

  updateComponentVariants(isDark: boolean) {
    const logomark = document.querySelector("puris-logomark");
    const logotype = document.querySelector("puris-logotype");
    if (logomark) logomark.setAttribute("variant", isDark ? "white" : "black");
    if (logotype) logotype.setAttribute("variant", isDark ? "white" : "black");
  }

  doabuttonthing() {
    console.log("button");
  }

  shakey(event: any) {
    console.log("*********", event.target);
    const anim = document.getElementById("nonobutton");
    if (anim) {
      anim.setAttribute("play", "");
    }
  }

  moreButtons() {
    const dataTag = document.getElementById("h6idthing");
    if (dataTag) {
      dataTag.style.backgroundColor = "#00d37b";
    }
  }
}
