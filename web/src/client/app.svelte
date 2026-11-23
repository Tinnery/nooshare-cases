<script lang="ts">
  let message = $state("");

  async function hello() {
    const response = await fetch("/api/hello");
    const data = await response.json();
    message = data.message;
  }
</script>

<main>
  <h1>NooShare Cases</h1>
  <button onclick={hello}>Hello</button>
  <p>{message}</p>
</main>
