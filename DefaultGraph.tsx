import {
    addContextMenu,
    addVisibleRangeRealTime,
    colors,
    createCommonDefaultSciChartSurface,
    setThemeGraph,
    showGraphAnnotations,
} from '../helpers/UtilsFunctions';
import React, { useEffect, useRef, useState } from 'react';
import {
    EAutoRange,
    EllipsePointMarker,
    FastLineRenderableSeries,
    NumberRange,
    NumericAxis,
    SciChartOverview,
    SciChartSurface,
    XyDataSeries,
    XyScatterRenderableSeries,
} from 'scichart';
import { CustomXyDataSeries } from '../helpers/CustomXyDataSeries';
import { setLoading } from '../../../../Redux/Reducers/SystemDataSlice';
import { useDispatch, useSelector } from 'react-redux';
import { TSciChart } from 'scichart/types/TSciChart';
import { setActiveButtonsDefault, setActiveRealTime } from '../../../../Redux/Reducers/ArchiveTabSlice';
import { KdDivider, KdGridPanel, KdStackPanel, KdText } from '@ui/kd-ui-kit';
import { AppState } from '../../../../Redux/Store';
import signalRHandlerRegistry, { Message } from '../../../Service/SignalRHandlerRegistry';
import { NewValueParameter } from '../../../../Helpers/MeasurementTableHelpers/UtilsFunctions';
import AccordionDefault from './AccordionDefault';
import ContextMenu from './ContextMenu';
import { useTranslation } from 'react-i18next';
import { selectItemById } from '../../../NodesTree/Service/HelpFunctions';
import { IKdTabPanelApi, TabPage } from '@ui/kd-ui-kit/build/components/kdTabPanel/KdTabPanel';
import { getTabPage } from '../../../../Helpers/ComponentsHelpers/UtilsFunctions';
import { ApiRef } from '@ui/kd-ui-kit/build/support/types';
import { IKdTreeViewApi } from '@ui/kd-ui-kit/build/components/kdTreeView/KdTreeView';
import { NodeForOutputProps } from '../../../../Helpers/NodeTreeHelpers/UtilsFunctions';
import { GraphData } from '../interfaces/GraphData';
import { Point } from '../interfaces/Point';
import { TimeInterval } from '../helpers/Enums';
import { getParameter } from '../../../../Helpers/ComponentsHelpers/HelpFunctions';

interface DefaultGraphProps {
    graphs: { graphs: GraphData[] } | null;
    dataSeriesRefs: React.MutableRefObject<CustomXyDataSeries[]>;
    graphStats: { [key: string]: { min: number; max: number } } | null;
    tabsApi: ApiRef<IKdTabPanelApi>;
    treeViewRef: ApiRef<IKdTreeViewApi<NodeForOutputProps>>;
}

const DefaultGraph: React.FC<DefaultGraphProps> = ({ graphs, dataSeriesRefs, graphStats, tabsApi, treeViewRef }) => {
    const yAxisDefaultRef = useRef<NumericAxis | null>(null);
    const sciChartSurfaceRef = useRef<SciChartSurface | null>(null);
    const wasmContextRef = useRef<TSciChart | null>(null);

    const [defaultAccordionLegendsState, setDefaultAccordionLegendsState] = useState<boolean>(false);
    const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; open: boolean } | null>(null);
    const [selectedPoint, setSelectedPoint] = useState<Point | null>(null);

    const dispatch = useDispatch();
    const { t } = useTranslation();

    const timeInterval = useSelector((state: AppState) => state.archiveTab.timeInterval);
    const activeRealTime = useSelector((state: AppState) => state.archiveTab.activeRealTime);
    const activeButtonsDefault = useSelector((state: AppState) => state.archiveTab.activeButtonsDefault);
    const autoRangeEnabled = useSelector((state: AppState) => state.archiveTab.autoRangeEnabled);

    const toggleDefaultAccordionLegends = () => {
        setDefaultAccordionLegendsState(!defaultAccordionLegendsState);
    };

    const handleContextMenuClose = () => {
        setContextMenu(null);
        setSelectedPoint(null);
    };

    const handleContextMenuAction = async (action: string) => {
        if (selectedPoint) {
            if (action === 'Spectrum' && selectedPoint.parameterId) {
                const parameter = getParameter(selectedPoint.parameterId);
                if (!parameter) {
                    console.error('Parameter not found in local storage:', selectedPoint.parameterId);
                    return;
                }
                await selectItemById(parameter.parentId, treeViewRef);
                const spectrumTab: TabPage = getTabPage('spectrum', tabsApi, treeViewRef, t);
                tabsApi.current.addPage(spectrumTab);
            }
        }
        handleContextMenuClose();
    };

    useEffect(() => {
        const theme = setThemeGraph();

        const initSciChart = async () => {
            dispatch(setLoading(true));
            SciChartSurface.UseCommunityLicense();

            dispatch(setActiveRealTime(false));

            const { sciChartSurface, wasmContext } = await SciChartSurface.create('scichart-root', { theme });

            createCommonDefaultSciChartSurface(sciChartSurface, wasmContext, yAxisDefaultRef);

            sciChartSurfaceRef.current = sciChartSurface;
            wasmContextRef.current = wasmContext;

            if (graphs) {
                graphs.graphs.forEach((graph, index) => {
                    const color = colors[index % colors.length];
                    const dataSeries = new CustomXyDataSeries(wasmContext, {
                        containsNaN: false,
                        dataIsSortedInX: true,
                    });
                    dataSeries.parameterId = graph.parameterId;
                    dataSeriesRefs.current[index] = dataSeries;

                    graph.points.forEach((point) => {
                        dataSeries.append(point.timeMark.getTime() / 1000, point.value);
                    });

                    const defaultLineSeries = new FastLineRenderableSeries(wasmContext, {
                        stroke: color,
                        strokeThickness: 1,
                        dataSeries,
                    });

                    sciChartSurface.renderableSeries.add(defaultLineSeries);
                    showGraphAnnotations(graph, color, sciChartSurface);
                });
            }

            await SciChartOverview.create(sciChartSurface, 'scichart-overview', { theme });

            if (activeButtonsDefault.usual) {
                dispatch(setActiveButtonsDefault('usual'));
            }
            if (activeButtonsDefault.special) {
                dispatch(setActiveButtonsDefault('special'));
            }
            if (activeButtonsDefault.failure) {
                dispatch(setActiveButtonsDefault('failure'));
            }
            if (activeButtonsDefault.relay) {
                dispatch(setActiveButtonsDefault('relay'));
            }

            dispatch(setLoading(false));
        };

        initSciChart().catch((error) => console.error(error));

        return () => {
            sciChartSurfaceRef.current?.delete();
            dataSeriesRefs.current = [];
        };
    }, [graphs]);

    useEffect(() => {
        const handlerNewValueParameter = (message: Message) => {
            const newValueParameter = message as unknown as NewValueParameter | undefined;

            if (!activeRealTime) return;
            if (!newValueParameter) return;

            const param = getParameter(newValueParameter.id);
            if (!param) return;

            if (dataSeriesRefs.current.length > 0 && timeInterval === TimeInterval.Hour) {
                const parameterId = newValueParameter.id;
                const value = newValueParameter.value;
                const timeMark = new Date(newValueParameter.time).getTime() / 1000;

                const dataSeries = dataSeriesRefs.current.find((ds) => ds.parameterId === parameterId);

                if (dataSeries) {
                    addVisibleRangeRealTime(dataSeries!, timeMark, value, sciChartSurfaceRef.current!, new NumberRange(0.03, 0.1));
                }
            }
        };
        signalRHandlerRegistry.registerHandler('NewValueParameter', handlerNewValueParameter);
        return () => {
            signalRHandlerRegistry.removeHandler('NewValueParameter', handlerNewValueParameter);
        };
    }, [dataSeriesRefs.current, timeInterval, activeRealTime]);

    useEffect(() => {
        if (sciChartSurfaceRef.current && wasmContextRef.current) {
            dispatch(setLoading(true));
            dispatch(setActiveRealTime(false));
            if (graphs) {
                graphs.graphs.forEach((graph, index) => {
                    const color = colors[index % colors.length];

                    const currentButtons = activeButtonsDefault || {
                        usual: false,
                        special: false,
                        failure: false,
                        relay: false,
                    };

                    const usualSeriesId = `usualSeries-${index}`;
                    const failureSeriesId = `failureSeries-${index}`;
                    const specialSeriesId = `specialSeries-${index}`;
                    const relaySeriesId = `relaySeries-${index}`;
                    const relayAnnotationId = `relayAnnotation-${index}`;

                    const removeSeriesById = (id: string) => {
                        const seriesToRemove = sciChartSurfaceRef.current!.renderableSeries.getById(id);
                        if (seriesToRemove) {
                            sciChartSurfaceRef.current!.renderableSeries.remove(seriesToRemove);
                        }
                    };

                    removeSeriesById(usualSeriesId);
                    removeSeriesById(failureSeriesId);
                    removeSeriesById(specialSeriesId);
                    removeSeriesById(relaySeriesId);

                    const removeAnnotationById = (id: string) => {
                        const annotationToRemove = sciChartSurfaceRef.current!.annotations.getById(id);
                        if (annotationToRemove) {
                            sciChartSurfaceRef.current!.annotations.remove(annotationToRemove);
                        }
                    };
                    removeAnnotationById(relayAnnotationId);

                    if (currentButtons.usual) {
                        const usualPointMarker = new EllipsePointMarker(wasmContextRef.current!, {
                            width: 6,
                            height: 6,
                            fill: color,
                            stroke: 'white',
                            strokeThickness: 1,
                        });

                        const usualPointSeries = new XyScatterRenderableSeries(wasmContextRef.current!, {
                            pointMarker: usualPointMarker,
                            id: usualSeriesId,
                        });

                        const markerDataSeries = new XyDataSeries(wasmContextRef.current!);
                        graph.points.forEach((point) => {
                            markerDataSeries.append(point.timeMark.getTime() / 1000, point.value);
                        });

                        usualPointSeries.dataSeries = markerDataSeries;
                        usualPointSeries.rolloverModifierProps.showRollover = false;

                        sciChartSurfaceRef.current!.renderableSeries.add(usualPointSeries);
                    }

                    if (currentButtons.special) {
                        const specialPointMarker = new EllipsePointMarker(wasmContextRef.current!, {
                            width: 10,
                            height: 10,
                            fill: color,
                            stroke: 'white',
                            strokeThickness: 2,
                        });

                        const specialPointSeries = new XyScatterRenderableSeries(wasmContextRef.current!, {
                            pointMarker: specialPointMarker,
                            id: specialSeriesId,
                        });

                        const markerDataSeries = new XyDataSeries(wasmContextRef.current!);
                        graph.points.forEach((point) => {
                            if (point.spectrumAvailable) {
                                markerDataSeries.append(point.timeMark.getTime() / 1000, point.value);
                            }
                        });

                        specialPointSeries.dataSeries = markerDataSeries;
                        specialPointSeries.rolloverModifierProps.showRollover = false;

                        sciChartSurfaceRef.current!.renderableSeries.add(specialPointSeries);

                        addContextMenu(
                            sciChartSurfaceRef.current!,
                            specialPointSeries,
                            setSelectedPoint,
                            setContextMenu,
                            graph.parameterId,
                        );
                    }

                    sciChartSurfaceRef.current!.invalidateElement();
                });
            }
            dispatch(setLoading(false));
        }
    }, [activeButtonsDefault, graphs, timeInterval]);

    useEffect(() => {
        if (yAxisDefaultRef.current) {
            yAxisDefaultRef.current.autoRange = autoRangeEnabled ? EAutoRange.Always : EAutoRange.Never;

            sciChartSurfaceRef.current?.invalidateElement();
        }
    }, [autoRangeEnabled]);

    return (
        <KdGridPanel columns={['*', 'auto']} spacing={1}>
            <KdStackPanel orientation="vertical">
                <div id="scichart-overview" style={{ height: '100px' }} />
                <KdDivider orientation="horizontal" spacing={2} />
                <div id="scichart-root" style={{ height: '500px' }} />
            </KdStackPanel>
            <KdStackPanel>
                <div
                    style={{
                        width: defaultAccordionLegendsState ? '250px' : '0px',
                        height: '610px',
                        transition: 'width 0.3s',
                        overflow: 'hidden',
                    }}
                >
                    <div className="legend-container">
                        {graphs?.graphs.map((graph, index) => (
                            <AccordionDefault key={index} index={index} graph={graph} graphStats={graphStats} />
                        ))}
                    </div>
                </div>
                <div className="accordion-container" onClick={toggleDefaultAccordionLegends}>
                    <div
                        className="settings-panel-title"
                        style={{ fontSize: '14px', writingMode: 'vertical-rl', paddingLeft: '4px', paddingTop: '10px' }}
                    >
                        <KdText content={t('legend')} type="heading 5" />
                    </div>
                </div>
            </KdStackPanel>
            <ContextMenu
                contextMenu={contextMenu}
                handleContextMenuClose={handleContextMenuClose}
                handleContextMenuAction={handleContextMenuAction}
            />
        </KdGridPanel>
    );
};

export default React.memo(DefaultGraph);
