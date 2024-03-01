<script>
  import Stub from "./ToDo.svelte";
  import { getData } from "./data.js";
  
  const { users, tasks, projects } = getData();
</script>

<Stub {users} {tasks} {projects} />
