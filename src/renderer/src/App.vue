<template>
  <MainComponent />
</template>

<script>
import MainComponent from './components/MainComponent.vue';

export default {
  name: 'App',
  components: {
    MainComponent,
  },
};
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background: transparent;
}

html,
body {
  height: 100%;
  margin: 0;
  background: transparent;
}

#app {
  height: 100%;
}
</style>
