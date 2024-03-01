<script>
    import { onMount } from "svelte";
    
    import { ToDo } from "@dhx/trial-todolist";
    import "@dhx/trial-todolist/dist/todo.css";
    
    export let users;
    export let tasks;
    export let projects;

    let container;
    onMount(() => {
        new ToDo(container, {
            users, tasks, projects
        })
    });
</script>

<div bind:this={container} style="width: 100%; height: 100%;"></div>

