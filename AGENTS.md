# Build and test preference

- Build and test execution is enabled at the user's request.
- Use GPT-5.6 Luna with reasoning effort `max` for build and test work when that model is available.
- If GPT-5.6 Luna is unavailable, delegate build and test work to GPT-6 Luna with reasoning effort `max`, as authorized by the user. Clearly state which model is used.
- This preference does not authorize a GitHub push by itself; follow the user's instructions for the current task.
