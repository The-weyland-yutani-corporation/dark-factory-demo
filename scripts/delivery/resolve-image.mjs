import {
  required,
  run,
  validateDeliveryImage,
  validateDeliveryImageReference,
  writeOutput,
} from "./lib.mjs";

const imageRef = required("IMAGE_REF");
const registryServer = required("ACR_LOGIN_SERVER").replace(/\/$/, "");
const imageRepository = required("IMAGE_REPOSITORY").replace(/^\/|\/$/g, "");

validateDeliveryImageReference({
  imageRef,
  registryServer,
  imageRepository,
});

run("docker", ["pull", imageRef], { capture: false });
const inspection = JSON.parse(
  run("docker", ["inspect", "--format={{json .Config}}", imageRef]),
);
const resolved = validateDeliveryImage({
  imageRef,
  registryServer,
  imageRepository,
  labels: inspection.Labels,
  environment: inspection.Env,
});

await writeOutput("image_ref", resolved.imageRef);
await writeOutput("commit_sha", resolved.commit);
