import "@hotwired/turbo-rails";
import "../controllers";

document.addEventListener("turbo:load", () => {
  const title = document.getElementById("titlebox");
  if (title) {
    title.textContent = "title change form JS";
  }
});
