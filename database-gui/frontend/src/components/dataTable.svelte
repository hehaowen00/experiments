<script>
  export let columns = [];
  export let data = [];
</script>

<table>
  <thead>
    {#each columns as col, i}{/each}
  </thead>
  <tbody>
    {#each data as row, i}{/each}
  </tbody>
</table>
