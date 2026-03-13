import { application } from "./application";

const controllers = import.meta.glob("./**/*_controller.js", { eager: true });

for (const path in controllers) {
  const module = controllers[path];
  const controllerName = path
    .replace("./", "")
    .replace("_controller.js", "")
    .replace(/\//g, "--")
    .replace(/_/g, "-");

  if (module.default) {
    application.register(controllerName, module.default);
  }
}
