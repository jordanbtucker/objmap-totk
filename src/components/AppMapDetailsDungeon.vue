<template>
  <section>
    <h2 class="location-sub">{{sub}}</h2>
    <div>Dungeon number: {{marker.data.dungeonNum}}</div>
    <div v-if="marker.data.lm.l.ShrineInCave" style="color: orange"><i class="fa fa-exclamation-circle"></i> Inside Cave</div>
    <hr>
    <section v-if="tboxObjs.length">
      <h4 class="subsection-heading">Treasure Chests</h4>
      <div class="search-results">
        <ObjectInfo v-for="tbox in tboxObjs" :key="tbox.objid" :obj="tbox" drop-as-name />
      </div>
    </section>
    <section v-if="enemies.length">
      <h4 class="subsection-heading">Enemies</h4>
      <div class="search-results">
        <ObjectInfo v-for="enemy in enemies" :key="enemy.objid" :obj="enemy" />
      </div>
    </section>

  </section>
</template>
<style lang="less">
</style>
<script src="./AppMapDetailsDungeon.ts"></script>
