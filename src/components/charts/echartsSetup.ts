import * as echarts from 'echarts/core';
import {
  LineChart,
  BarChart,
  CandlestickChart,
  ScatterChart,
  TreemapChart,
  HeatmapChart,
} from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  DataZoomComponent,
  GraphicComponent,
  VisualMapComponent,
  MarkPointComponent,
  LegendComponent,
  TitleComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// 必须用静态命名导入才能 tree-shake 掉未用的图表类型；
// 动态 import('echarts/charts') 拿到的是完整命名空间，会把所有 series 打进 chunk
echarts.use([
  LineChart,
  BarChart,
  CandlestickChart,
  ScatterChart,
  TreemapChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  DataZoomComponent,
  GraphicComponent,
  VisualMapComponent,
  MarkPointComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
]);

export { echarts };
