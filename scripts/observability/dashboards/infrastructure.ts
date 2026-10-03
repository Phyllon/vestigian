import { Dashboard, STEPS, quantile } from './helpers'

/**
 * Everything underneath the application: the host, each container, Postgres,
 * Valkey and the Node process. All of it was already being scraped by Alloy's
 * built-in exporters and shown nowhere.
 */
const CONTAINER = 'name=~".+"'
const PHYSICAL_NIC = 'device!~"lo|veth.*|docker.*|br-.*|cni.*|flannel.*"'
const REAL_FS = 'fstype!~"tmpfs|overlay|squashfs|ramfs|devtmpfs|erofs|iso9660"'

export const buildInfrastructure = (): Record<string, unknown> =>
  new Dashboard({
    uid: 'vestigian-infrastructure',
    title: 'Vestigian — infrastructure',
    description: 'Host, containers, Postgres, Valkey and the Node process.',
    tags: ['infrastructure'],
  })
    .row('Host')
    .stat('CPU used', '1 - avg(rate(node_cpu_seconds_total{mode="idle"}[$__rate_interval]))', {
      unit: 'percentunit',
      min: 0,
      max: 1,
      thresholds: STEPS.higherIsWorse(0.7, 0.9),
    })
    .stat(
      'Memory used',
      '1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)',
      {
        unit: 'percentunit',
        min: 0,
        max: 1,
        thresholds: STEPS.higherIsWorse(0.8, 0.92),
      },
    )
    .stat(
      'Fullest disk',
      `max(1 - node_filesystem_avail_bytes{${REAL_FS}} / node_filesystem_size_bytes{${REAL_FS}} and on (instance, device, mountpoint) node_filesystem_readonly == 0)`,
      {
        unit: 'percentunit',
        min: 0,
        max: 1,
        thresholds: STEPS.higherIsWorse(0.75, 0.85),
        description: 'Read-only mounts are excluded — they always report 100% used.',
      },
    )
    .stat(
      'Load (1m) per core',
      'sum(node_load1) / count(count by (cpu) (node_cpu_seconds_total))',
      {
        decimals: 2,
        thresholds: STEPS.higherIsWorse(0.8, 1.5),
      },
    )
    .stat('Uptime', 'time() - max(node_boot_time_seconds)', { unit: 's', graph: false })
    .stat(
      'Swap in use',
      '1 - sum(node_memory_SwapFree_bytes) / clamp_min(sum(node_memory_SwapTotal_bytes), 1)',
      {
        unit: 'percentunit',
        min: 0,
        max: 1,
        thresholds: STEPS.higherIsWorse(0.1, 0.5),
      },
    )
    .timeseries(
      'CPU by mode',
      [
        {
          expr: 'avg by (mode) (rate(node_cpu_seconds_total{mode!="idle"}[$__rate_interval]))',
          legend: '{{mode}}',
        },
      ],
      { unit: 'percentunit', stacked: true, max: 1 },
    )
    .timeseries(
      'Memory',
      [
        {
          expr: 'sum(node_memory_MemTotal_bytes) - sum(node_memory_MemAvailable_bytes)',
          legend: 'used',
        },
        { expr: 'sum(node_memory_Cached_bytes)', legend: 'page cache' },
        { expr: 'sum(node_memory_MemAvailable_bytes)', legend: 'available' },
      ],
      { unit: 'bytes' },
    )
    .timeseries(
      'Load average',
      [
        { expr: 'node_load1', legend: '1m' },
        { expr: 'node_load5', legend: '5m' },
        { expr: 'node_load15', legend: '15m' },
      ],
      { decimals: 2 },
    )
    .timeseries(
      'Network throughput',
      [
        {
          expr: `sum(rate(node_network_receive_bytes_total{${PHYSICAL_NIC}}[$__rate_interval]))`,
          legend: 'in',
        },
        {
          expr: `-sum(rate(node_network_transmit_bytes_total{${PHYSICAL_NIC}}[$__rate_interval]))`,
          legend: 'out',
        },
      ],
      {
        unit: 'Bps',
        description: 'Out is drawn below zero. Virtual and bridge interfaces are excluded.',
      },
    )
    .timeseries(
      'Disk throughput',
      [
        { expr: 'sum(rate(node_disk_read_bytes_total[$__rate_interval]))', legend: 'read' },
        { expr: '-sum(rate(node_disk_written_bytes_total[$__rate_interval]))', legend: 'write' },
      ],
      { unit: 'Bps' },
    )
    .timeseries(
      'Disk busy',
      [
        {
          expr: 'max by (device) (rate(node_disk_io_time_seconds_total[$__rate_interval]))',
          legend: '{{device}}',
        },
      ],
      { unit: 'percentunit', max: 1 },
    )
    .timeseries(
      'Filesystem used',
      [
        {
          expr: `1 - node_filesystem_avail_bytes{${REAL_FS}} / node_filesystem_size_bytes{${REAL_FS}}`,
          legend: '{{mountpoint}}',
        },
      ],
      {
        unit: 'percentunit',
        max: 1,
        description: 'Prometheus, Loki, Tempo and the nightly dumps all write to this disk.',
      },
    )
    .row('Containers')
    .timeseries(
      'CPU by container',
      [
        {
          expr: `sum by (name) (rate(container_cpu_usage_seconds_total{${CONTAINER}}[$__rate_interval]))`,
          legend: '{{name}}',
        },
      ],
      { unit: 'none', description: 'In cores: 1.0 is one full core.' },
    )
    .timeseries(
      'Memory by container',
      [
        {
          expr: `sum by (name) (container_memory_working_set_bytes{${CONTAINER}})`,
          legend: '{{name}}',
        },
      ],
      { unit: 'bytes', stacked: true },
    )
    .timeseries(
      'Network by container (in)',
      [
        {
          expr: `sum by (name) (rate(container_network_receive_bytes_total{${CONTAINER}}[$__rate_interval]))`,
          legend: '{{name}}',
        },
      ],
      { unit: 'Bps' },
    )
    .timeseries(
      'Network by container (out)',
      [
        {
          expr: `sum by (name) (rate(container_network_transmit_bytes_total{${CONTAINER}}[$__rate_interval]))`,
          legend: '{{name}}',
        },
      ],
      { unit: 'Bps' },
    )
    .bargauge(
      'Restarts in range',
      [
        {
          expr: `changes(container_start_time_seconds{${CONTAINER}}[$__range])`,
          legend: '{{name}}',
        },
      ],
      {
        thresholds: STEPS.higherIsWorse(1, 3),
        min: 0,
        description: 'A container that keeps restarting looks healthy at every individual scrape.',
        width: 8,
      },
    )
    .bargauge(
      'OOM kills in range',
      [
        {
          expr: `increase(container_oom_events_total{${CONTAINER}}[$__range])`,
          legend: '{{name}}',
        },
      ],
      { thresholds: STEPS.higherIsWorse(1, 1), min: 0, width: 8 },
    )
    .stat('Containers running', `count(container_last_seen{${CONTAINER}} > time() - 120)`, {
      graph: false,
      width: 8,
    })
    .row('Postgres')
    .stat('Up', 'pg_up', {
      graph: false,
      thresholds: STEPS.lowerIsWorse(1, 1),
      min: 0,
      max: 1,
      width: 3,
    })
    .stat('Connections used', 'sum(pg_stat_activity_count) / max(pg_settings_max_connections)', {
      unit: 'percentunit',
      min: 0,
      max: 1,
      thresholds: STEPS.higherIsWorse(0.6, 0.85),
      width: 3,
    })
    .stat(
      'Buffer cache hit',
      'sum(rate(pg_stat_database_blks_hit[$__rate_interval])) / clamp_min(sum(rate(pg_stat_database_blks_hit[$__rate_interval])) + sum(rate(pg_stat_database_blks_read[$__rate_interval])), 1)',
      {
        unit: 'percentunit',
        min: 0.8,
        max: 1,
        thresholds: STEPS.lowerIsWorse(0.9, 0.97),
        description: 'Below ~95% the working set no longer fits in shared buffers + page cache.',
        width: 4,
      },
    )
    .stat('Database size', 'sum(pg_database_size_bytes{datname!~"template.*|postgres"})', {
      unit: 'bytes',
      width: 4,
    })
    .stat('Deadlocks (range)', 'sum(increase(pg_stat_database_deadlocks[$__range]))', {
      thresholds: STEPS.higherIsWorse(1, 5),
      graph: false,
      width: 4,
    })
    .stat('Rolled back (range)', 'sum(increase(pg_stat_database_xact_rollback[$__range]))', {
      graph: false,
      width: 6,
    })
    .timeseries(
      'Connections by state',
      [{ expr: 'sum by (state) (pg_stat_activity_count)', legend: '{{state}}' }],
      { stacked: true },
    )
    .timeseries(
      'Transactions',
      [
        { expr: 'sum(rate(pg_stat_database_xact_commit[$__rate_interval]))', legend: 'commit' },
        { expr: 'sum(rate(pg_stat_database_xact_rollback[$__rate_interval]))', legend: 'rollback' },
      ],
      { unit: 'ops' },
    )
    .timeseries(
      'Rows per second',
      [
        { expr: 'sum(rate(pg_stat_database_tup_returned[$__rate_interval]))', legend: 'scanned' },
        { expr: 'sum(rate(pg_stat_database_tup_fetched[$__rate_interval]))', legend: 'fetched' },
        { expr: 'sum(rate(pg_stat_database_tup_inserted[$__rate_interval]))', legend: 'inserted' },
        { expr: 'sum(rate(pg_stat_database_tup_updated[$__rate_interval]))', legend: 'updated' },
        { expr: 'sum(rate(pg_stat_database_tup_deleted[$__rate_interval]))', legend: 'deleted' },
      ],
      {
        unit: 'rowsps',
        description: 'Scanned far above fetched means queries are reading rows they then discard.',
      },
    )
    .timeseries(
      'Database size over time',
      [{ expr: 'pg_database_size_bytes{datname!~"template.*|postgres"}', legend: '{{datname}}' }],
      { unit: 'bytes' },
    )
    .timeseries('Locks by mode', [{ expr: 'sum by (mode) (pg_locks_count)', legend: '{{mode}}' }], {
      stacked: true,
    })
    .timeseries(
      'Temp files and conflicts',
      [
        {
          expr: 'sum(rate(pg_stat_database_temp_bytes[$__rate_interval]))',
          legend: 'temp bytes/s',
        },
        { expr: 'sum(rate(pg_stat_database_conflicts[$__rate_interval]))', legend: 'conflicts/s' },
      ],
      { description: 'Temp files mean a sort or hash spilled out of work_mem.' },
    )
    .bargauge(
      'Dead tuples by table',
      [{ expr: 'topk(10, pg_stat_user_tables_n_dead_tup)', legend: '{{relname}}' }],
      { thresholds: STEPS.higherIsWorse(50_000, 500_000), min: 0 },
    )
    .bargauge(
      'Sequential scans by table',
      [
        {
          expr: 'topk(10, increase(pg_stat_user_tables_seq_scan[$__range]))',
          legend: '{{relname}}',
        },
      ],
      {
        min: 0,
        description:
          'The tile queries must use the GiST index; a sequential scan on `sites` is the regression to catch.',
      },
    )
    .row('Valkey')
    .stat('Up', 'redis_up', {
      graph: false,
      thresholds: STEPS.lowerIsWorse(1, 1),
      min: 0,
      max: 1,
      width: 3,
    })
    .stat(
      'Hit rate',
      'rate(redis_keyspace_hits_total[$__rate_interval]) / clamp_min(rate(redis_keyspace_hits_total[$__rate_interval]) + rate(redis_keyspace_misses_total[$__rate_interval]), 0.001)',
      { unit: 'percentunit', min: 0, max: 1, width: 3 },
    )
    .stat('Memory', 'redis_memory_used_bytes', { unit: 'bytes', width: 4 })
    .stat('Keys', 'sum(redis_db_keys)', { width: 4 })
    .stat('Clients', 'redis_connected_clients', { width: 4 })
    .stat('Evictions (range)', 'increase(redis_evicted_keys_total[$__range])', {
      thresholds: STEPS.higherIsWorse(1, 100),
      graph: false,
      width: 6,
      description: 'Evicted tiles and rate-limit counters. Non-zero means maxmemory is too small.',
    })
    .timeseries(
      'Memory used vs limit',
      [
        { expr: 'redis_memory_used_bytes', legend: 'used' },
        { expr: 'redis_memory_max_bytes > 0', legend: 'maxmemory' },
      ],
      { unit: 'bytes' },
    )
    .timeseries(
      'Commands per second',
      [{ expr: 'rate(redis_commands_processed_total[$__rate_interval])', legend: 'commands' }],
      { unit: 'ops' },
    )
    .timeseries(
      'Hits and misses',
      [
        { expr: 'rate(redis_keyspace_hits_total[$__rate_interval])', legend: 'hits' },
        { expr: 'rate(redis_keyspace_misses_total[$__rate_interval])', legend: 'misses' },
      ],
      { unit: 'ops' },
    )
    .timeseries(
      'Expired and evicted keys',
      [
        { expr: 'rate(redis_expired_keys_total[$__rate_interval])', legend: 'expired' },
        { expr: 'rate(redis_evicted_keys_total[$__rate_interval])', legend: 'evicted' },
      ],
      { unit: 'ops' },
    )
    .row('Node.js process')
    .timeseries(
      'Memory',
      [
        { expr: 'process_resident_memory_bytes{job="vestigian-app"}', legend: 'resident' },
        { expr: 'nodejs_heap_size_used_bytes{job="vestigian-app"}', legend: 'heap used' },
        { expr: 'nodejs_heap_size_total_bytes{job="vestigian-app"}', legend: 'heap total' },
      ],
      { unit: 'bytes' },
    )
    .timeseries(
      'CPU',
      [
        {
          expr: 'rate(process_cpu_seconds_total{job="vestigian-app"}[$__rate_interval])',
          legend: 'cores',
        },
      ],
      { description: 'One Node process is one core: sustained 1.0 is saturation.' },
    )
    .timeseries(
      'Event loop lag',
      [
        { expr: 'nodejs_eventloop_lag_p50_seconds{job="vestigian-app"}', legend: 'p50' },
        { expr: 'nodejs_eventloop_lag_p99_seconds{job="vestigian-app"}', legend: 'p99' },
        { expr: 'nodejs_eventloop_lag_max_seconds{job="vestigian-app"}', legend: 'max' },
      ],
      { unit: 's' },
    )
    .timeseries(
      'GC pause p95 by kind',
      [
        {
          expr: quantile(0.95, 'nodejs_gc_duration_seconds', {
            by: ['kind'],
            selector: '{job="vestigian-app"}',
          }),
          legend: '{{kind}}',
        },
      ],
      { unit: 's' },
    )
    .timeseries('Open file descriptors', [
      { expr: 'process_open_fds{job="vestigian-app"}', legend: 'open' },
      { expr: 'process_max_fds{job="vestigian-app"}', legend: 'limit' },
    ])
    .timeseries('Active handles and requests', [
      { expr: 'nodejs_active_handles_total{job="vestigian-app"}', legend: 'handles' },
      { expr: 'nodejs_active_requests_total{job="vestigian-app"}', legend: 'requests' },
    ])
    .build()
