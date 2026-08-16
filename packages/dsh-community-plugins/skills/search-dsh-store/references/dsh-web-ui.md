# dsh-web-ui integration

This package exposes one `store_details` argument: pass `selector` as either the exact repository ID returned by `store_search` or the exact GitHub `owner/repository` name. Do not pass separate `repository_id` or `full_name` arguments to `store_details`.

For a verified GitHub project, use `store_details` to determine whether both `verified` and `latest` install modes are available. Ask the user to choose one before calling `store_install`; never infer the choice.

- Pass `install_mode: verified` to install the exact GitHub SHA that produced the Store validation evidence.
- Pass `install_mode: latest` to install the repository's current default branch. State that this revision may not have passed Store validation yet.

If both modes are available and the user has not chosen, stop and ask. Do not call the mutation tool until the choice is explicit. For projects without both choices, omit `install_mode` and use the API-owned plan.
