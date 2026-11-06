# Engine release

**English** · [中文](releasing-ch.md)

reactive-md has an independent version. The editor publishes reactive-md-editor from its own repository and the Demo builds its own website artifact. See [repository migration](../integration/repository-split-en.md) for candidate updates and import changes.

1. Confirm branch, clean intended diff, target version and registry state. Update package.json, package-lock.json, changelog and relevant compatibility notes. Package and syntax/protocol versions are independent.
2. Run npm ci, npm run check, npm run notices. Review the packed exports, declaration paths and notices. The public-package check installs an actual tarball in an independent consumer; no Demo/editor checkout is needed.
3. Commit/push the authorized release source. Trigger publish.yml on that ref with the chosen dist_tag and update_latest. The workflow uses Node24, npm ^11.21 and npm trusted publishing (OIDC); preserve the workflow filename configured on npm. It checks/builds the package before packing and publishes only if that version does not exist. Existing versions only update the requested tags. Do not publish or change tags through a local npm login.
4. Confirm workflow success, registry version, tags and integrity. Tag/release the matching source when authorized. Verify the published package in a clean consumer before upgrading downstream registry dependencies.

The editor needs its own npm trusted publisher for its repository and publish.yml. Candidate tarballs remain locked in consumer vendor directories until registry publication. Pushing code does not authorize npm publication or site deployment.
