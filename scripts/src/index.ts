import dotenv = require('dotenv'); // key environment
import {Task, TodoistApi} from '@doist/todoist-api-typescript'; // todoist api
import {Client} from '@notionhq/client'; // notion api
import {
  PageObjectResponse,
  QueryDatabaseResponse,
} from '@notionhq/client/build/src/api-endpoints';

// ------------------- auth keys ------------------------------//

dotenv.config();
const todoistKey = String(process.env.TODOISTKEY);
const notionKey = String(process.env.NOTIONKEY);
const databaseId = String(process.env.DATABASEID);

// ----------------- API initialisations -----------------------//

const todoistApi: TodoistApi = new TodoistApi(todoistKey);
const notionApi: Client = new Client({auth: notionKey});

// ------------ General helper function ---------------------- //

function objectToMap(object: object): Map<string, any> {
  const map = new Map();
  const keys = Object.keys(object);
  const values = Object.values(object);
  for (let i = 0; i < keys.length; i++) {
    map.set(keys[i], values[i]);
  }
  return map;
}

function bubbleSortTaskList(taskList: Array<PageObjectResponse>): void {
  let swapCounter = -1;
  while (swapCounter !== 0) {
    swapCounter = 0;
    for (let i = 0; i + 1 < taskList.length; i++) {
      const currentTask: PageObjectResponse = taskList[i];
      const nextTask: PageObjectResponse = taskList[i + 1];
      if (currentTask.created_time > nextTask.created_time) {
        taskList[i] = nextTask;
        taskList[i + 1] = currentTask;
        swapCounter++;
      }
    }
  }
}

// ------------ Get Notion Property functions ----------------- //

function getNotionDescriptionProperty(pageObject: PageObjectResponse): string {
  const propertiesObject = pageObject.properties as object;
  const map = objectToMap(propertiesObject);
  const richTextObject = map.get('Description').rich_text[0] as object;
  if (!richTextObject) return '';
  return objectToMap(richTextObject).get('plain_text');
}

function getNotionDueProperty(pageObject: PageObjectResponse): string {
  const propertiesObject = pageObject.properties as object;
  const map = objectToMap(propertiesObject);
  const dateObject = map.get('Due').date as object;
  if (!dateObject) return '';
  return objectToMap(dateObject).get('start');
}

function getNotionStatusProperty(pageObject: PageObjectResponse): boolean {
  const propertiesObject = pageObject.properties as object;
  const map = objectToMap(propertiesObject);
  return map.get('Status').checkbox as boolean;
}

function getNotionTodoistIDProperty(pageObject: PageObjectResponse): string {
  const propertiesObject = pageObject.properties as object;
  const map = objectToMap(propertiesObject);
  const number = map.get('TodoistID').number;
  return !number ? '' : String(number);
}

function getNotionTodoistURLProperty(pageObject: PageObjectResponse): string {
  const propertiesObject = pageObject.properties as object;
  const map = objectToMap(propertiesObject);
  const richTextObject = map.get('URL').rich_text[0] as object;
  if (!richTextObject) return '';
  return objectToMap(richTextObject).get('plain_text');
}

function getNotionTitleProperty(pageObject: PageObjectResponse): string {
  const propertiesObject = pageObject.properties as object;
  const map = objectToMap(propertiesObject);
  const titleobject = map.get('Task').title[0] as object;
  return objectToMap(titleobject).get('plain_text');
}

// ----------------- API query/search functions -------------------- //

async function IDSearchNotion(
  todoistID: number
): Promise<PageObjectResponse | null> {
  const searchResults: QueryDatabaseResponse = await notionApi.databases.query({
    database_id: databaseId,
    filter: {
      and: [
        {
          property: 'TodoistID',
          number: {equals: todoistID},
        },
      ],
    },
  });
  if (searchResults.results.length === 0) return null;
  return searchResults.results[0] as PageObjectResponse;
}

async function notionActivePages(): Promise<PageObjectResponse[]> {
  const queryResponse: QueryDatabaseResponse = await notionApi.databases.query({
    database_id: databaseId,
    filter: {
      property: 'Status',
      checkbox: {equals: false},
    },
  });
  return queryResponse.results as Array<PageObjectResponse>;
}

async function notionNeedsUpdatePages(): Promise<PageObjectResponse[]> {
  const queryResponse: QueryDatabaseResponse = await notionApi.databases.query({
    database_id: databaseId,
    filter: {
      property: 'Sync status',
      select: {equals: 'NeedsUpdate'},
    },
  });
  return queryResponse.results as Array<PageObjectResponse>;
}

// --------------- Task/Page creation & update functions --------------//

async function newNotionPage(todoistTask: Task): Promise<PageObjectResponse> {
  const newPage = (await notionApi.pages.create({
    parent: {
      type: 'database_id',
      database_id: databaseId,
    },
    properties: {
      Task: {
        title: [{text: {content: todoistTask.content}}],
      },
      TodoistID: {
        number: Number(todoistTask.id),
      },
      Status: {
        checkbox: todoistTask.isCompleted ?? false,
      },
      URL: {
        url: todoistTask.url ?? null,
      },
      Description: {
        rich_text: [
          {
            type: 'text',
            text: {content: todoistTask.description ?? ''},
          },
        ],
      },
      'Sync status': {
        select: {name: 'Updated'},
      },
    },
  })) as PageObjectResponse;

  const pageID = newPage.id;
  if (todoistTask.due) {
    await notionApi.pages.update({
      page_id: pageID,
      properties: {
        Due: {
          date: {start: todoistTask.due.date},
        },
      },
    });
  }
  return newPage;
}

async function updateNotionPage(
  notionPageID: string,
  todoistTask: Task
): Promise<PageObjectResponse> {
  const updatedPage = await notionApi.pages.update({
    page_id: notionPageID,
    properties: {
      Task: {
        title: [{text: {content: todoistTask.content}}],
      },
      TodoistID: {
        number: Number(todoistTask.id),
      },
      Status: {
        checkbox: todoistTask.isCompleted ?? false,
      },
      URL: {
        url: todoistTask.url ?? null,
      },
      Description: {
        rich_text: [
          {
            type: 'text',
            text: {content: todoistTask.description ?? ''},
          },
        ],
      },
      'Sync status': {
        select: {name: 'Updated'},
      },
    },
  });

  if (todoistTask.due) {
    await notionApi.pages.update({
      page_id: updatedPage.id,
      properties: {
        Due: {
          date: {start: todoistTask.due.date},
        },
      },
    });
  }
  return updatedPage as PageObjectResponse;
}

async function newTodoistTask(notionPageObject: PageObjectResponse): Promise<Task> {
  const notionTitle = getNotionTitleProperty(notionPageObject);
  const notionDescription = getNotionDescriptionProperty(notionPageObject);
  const notionDue = getNotionDueProperty(notionPageObject);

  return await todoistApi.addTask({
    content: notionTitle,
    description: notionDescription,
    ...(notionDue ? {dueDate: notionDue} : {}),
  });
}

async function updateTodoistTask(
  taskID: string,
  notionPageObject: PageObjectResponse
): Promise<Task> {
  const notionTitle = getNotionTitleProperty(notionPageObject);
  const notionDescription = getNotionDescriptionProperty(notionPageObject);
  const notionDue = getNotionDueProperty(notionPageObject);

  return await todoistApi.updateTask(taskID, {
    content: notionTitle,
    description: notionDescription,
    ...(notionDue ? {dueDate: notionDue} : {}),
  });
}

// -------------- Structure (query/search/store) functions ------------//

function myTodoistIndexOf(todoistID: string): number {
  let index: number;
  if (IDs.todoistTaskIDs.includes(String(todoistID))) {
    index = IDs.todoistTaskIDs.indexOf(String(todoistID));
  } else {
    index = IDs.todoistTaskIDs.length;
    IDs.todoistTaskIDs[index] = String(todoistID);
  }
  return index;
}

function myNotionIndexOf(notionpageID: string): number {
  let index: number;
  if (IDs.notionPageIDs.includes(String(notionpageID))) {
    index = IDs.notionPageIDs.indexOf(String(notionpageID));
  } else {
    index = IDs.notionPageIDs.length;
    IDs.notionPageIDs[index] = String(notionpageID);
  }
  return index;
}

async function storeCurrentSyncedTasks(): Promise<void> {
  const todoistTaskList: Task[] = await todoistApi.getTasks();
  const len: number = todoistTaskList.length;

  for (let i = 0; i < len; i++) {
    const todoistTask: Task = todoistTaskList[i];
    const todoistID = todoistTask.id;
    IDs.todoistTaskIDs[i] = todoistID;
    const notionPage: PageObjectResponse | null = await IDSearchNotion(
      Number(todoistID)
    );
    if (notionPage) {
      IDs.notionPageIDs[i] = notionPage.id;
    }
  }
}

async function bubbleSortIDs(): Promise<void> {
  let swapCounter = -1;
  const len: number = IDs.todoistTaskIDs.length;

  while (swapCounter !== 0) {
    swapCounter = 0;
    for (let i = 0; i + 1 < len; i++) {
      const todoistID = IDs.todoistTaskIDs[i];
      const nextTodoistID = IDs.todoistTaskIDs[i + 1];
      const notionPageID = IDs.notionPageIDs[i];
      const nextNotionPageID = IDs.notionPageIDs[i + 1];

      const todoistTask: Task = await todoistApi.getTask(todoistID);
      const nextTodoistTask: Task = await todoistApi.getTask(nextTodoistID);

      // v4: createdAt field
      const createdTime = new Date(
        (todoistTask as any).createdAt ?? (todoistTask as any).addedAt
      );
      const nextCreatedTime = new Date(
        (nextTodoistTask as any).createdAt ?? (nextTodoistTask as any).addedAt
      );

      if (createdTime > nextCreatedTime) {
        IDs.todoistTaskIDs[i] = nextTodoistID;
        IDs.todoistTaskIDs[i + 1] = todoistID;
        IDs.notionPageIDs[i] = nextNotionPageID;
        IDs.notionPageIDs[i + 1] = notionPageID;
        swapCounter++;
      }
    }
  }
}

// -------------- Notion <-> Todoist auto sync functions ----------------//

async function checkTodoistCompletion(
  lastCheckedTodoistIndex: number,
  taskList: Array<Task>
): Promise<number> {
  if (
    lastCheckedTodoistIndex !== 0 &&
    taskList.length < lastCheckedTodoistIndex + 1
  ) {
    for (let i = 0; i < IDs.todoistTaskIDs.length; i++) {
      const todoistID = IDs.todoistTaskIDs[i];
      const todoistTask = await todoistApi.getTask(todoistID);
      if (todoistTask.isCompleted) {
        await updateNotionPage(IDs.notionPageIDs[i], todoistTask);
      }
    }
    lastCheckedTodoistIndex = taskList.length - 1;
  }
  return lastCheckedTodoistIndex;
}

async function checkTodoistIncompletion(taskList: Array<Task>): Promise<void> {
  const len = taskList.length;
  for (let i = 0; i < len; i++) {
    const todoistTask = taskList[i];
    const todoistTaskID = todoistTask.id;
    const notionPage: PageObjectResponse | null = await IDSearchNotion(
      Number(todoistTaskID)
    );
    if (notionPage) {
      const currentStatus = getNotionStatusProperty(notionPage);
      const index: number = myTodoistIndexOf(todoistTaskID);
      if (currentStatus) {
        await updateNotionPage(notionPage.id, todoistTask);
      }
      IDs.notionPageIDs[index] = notionPage.id;
    }
  }
}

async function checkNotionCompletion(
  lastCheckedNotiontIndex: number,
  taskList: Array<PageObjectResponse>
): Promise<number> {
  if (
    lastCheckedNotiontIndex !== 0 &&
    taskList.length < lastCheckedNotiontIndex + 1
  ) {
    for (let i = 0; i < IDs.notionPageIDs.length; i++) {
      const notionPageID = IDs.notionPageIDs[i];
      const notionPage = (await notionApi.pages.retrieve({
        page_id: notionPageID,
      })) as PageObjectResponse;
      if (getNotionStatusProperty(notionPage)) {
        const todoistId: string = getNotionTodoistIDProperty(notionPage);
        await todoistApi.closeTask(todoistId);
      }
    }
    lastCheckedNotiontIndex = taskList.length - 1;
  }
  return lastCheckedNotiontIndex;
}

async function checkNotionIncompletion(
  taskList: Array<PageObjectResponse>
): Promise<void> {
  const activeTodoistTasks: Array<Task> = await todoistApi.getTasks();
  const activeTodoistTaskIds: Array<string> = activeTodoistTasks.map(t => t.id);

  const len = taskList.length;
  for (let i = 0; i < len; i++) {
    const notionPage: PageObjectResponse = taskList[i];
    const notionPageID: string = notionPage.id;
    const todoistID: string = getNotionTodoistIDProperty(notionPage);
    const isActive: boolean = activeTodoistTaskIds.includes(todoistID);

    if (!isActive && todoistID) {
      const index: number = myNotionIndexOf(notionPageID);
      await todoistApi.reopenTask(todoistID);
      IDs.todoistTaskIDs[index] = todoistID;
    }
  }
}

async function notionUpToDateCheck(
  lastCheckedTodoistIndex: number
): Promise<number> {
  const taskList: Array<Task> = await todoistApi.getTasks();

  lastCheckedTodoistIndex = await checkTodoistCompletion(
    lastCheckedTodoistIndex,
    taskList
  );
  const taskListLength = taskList.length;

  if (taskListLength > 0) {
    for (let i: number = lastCheckedTodoistIndex + 1; i < taskListLength; i++) {
      const todoistTask: Task = taskList[i];
      const todoistID = Number(todoistTask.id);
      const notionPage: PageObjectResponse | null = await IDSearchNotion(todoistID);
      const index: number = myTodoistIndexOf(String(todoistID));

      if (!notionPage) {
        IDs.notionPageIDs[index] = (await newNotionPage(todoistTask)).id;
      } else if (notionPage) {
        checkTodoistIncompletion(taskList).then(bubbleSortIDs);
      }

      if (i === taskListLength - 1) return i;
    }
  }
  return taskListLength - 1;
}

async function todoistUpToDateCheck(lastCheckedNotionIndex: number) {
  console.log(lastCheckedNotionIndex);

  const taskList = (await notionActivePages()) as Array<PageObjectResponse>;
  lastCheckedNotionIndex = await checkNotionCompletion(
    lastCheckedNotionIndex,
    taskList
  );
  const taskListLength = taskList.length;
  bubbleSortTaskList(taskList);

  if (taskListLength > 0) {
    for (let i = lastCheckedNotionIndex + 1; i < taskListLength; i++) {
      const notionPage = taskList[i];
      const notionTodoistID = getNotionTodoistIDProperty(notionPage);

      if (!notionTodoistID) {
        const todoistTask: Task = await newTodoistTask(notionPage);
        const notionPageId = notionPage.id;
        await updateNotionPage(notionPageId, todoistTask);
        const index: number = myNotionIndexOf(notionPageId);
        IDs.todoistTaskIDs[index] = todoistTask.id;
      } else if (notionTodoistID) {
        checkNotionIncompletion(taskList).then(bubbleSortIDs);
      }

      if (i === taskListLength - 1) return i;
    }
  }
  return taskListLength - 1;
}

// ------------- Notion <-> Todoist manual sync functions --------------//

async function swapNotionSyncStatus(notionPageID: string): Promise<void> {
  await notionApi.pages.update({
    page_id: notionPageID,
    properties: {
      'Sync status': {
        select: {name: 'Updated'},
      },
    },
  });
}

async function notionManualUpdates(): Promise<void> {
  const pageList = (await notionNeedsUpdatePages()) as Array<PageObjectResponse>;
  if (pageList.length !== 0) {
    for (let i = 0; i < pageList.length; i++) {
      const notionPage = pageList[i] as PageObjectResponse;
      const notionPageID: string = notionPage.id;
      const index: number = myNotionIndexOf(notionPageID);
      const todoistID: string = IDs.todoistTaskIDs[index];

      if (!todoistID) {
        await todoistUpToDateCheck(0);
      } else {
        await updateTodoistTask(todoistID, notionPage);
      }

      if (getNotionStatusProperty(notionPage)) {
        await todoistApi.closeTask(todoistID);
      }
      await swapNotionSyncStatus(notionPageID);
    }
  }
}

async function todoistManualUpdates(): Promise<void> {
  const taskList: Array<Task> = await todoistApi.getTasks({filter: 'p3'});

  if (taskList.length) {
    for (let i = 0; i < taskList.length; i++) {
      const todoistTask = taskList[i] as Task;
      const todoistID: string = todoistTask.id;
      const notionPage = await IDSearchNotion(Number(todoistID));

      if (!notionPage) {
        await notionUpToDateCheck(0);
      } else {
        await updateNotionPage(notionPage.id, todoistTask);
      }

      await todoistApi.updateTask(todoistID, {priority: 1});
    }
  }
}

// ---------------------- Automation/Sync interval -------------------------//

async function intervalStart() {
  let latestNotionIndex = -1;
  let latestTodoistIndex = -1;

  setInterval(() => {
    todoistUpToDateCheck(latestTodoistIndex)
      .then(value => (latestTodoistIndex = value))
      .then(notionManualUpdates);
    notionUpToDateCheck(latestNotionIndex)
      .then(value => (latestNotionIndex = value))
      .then(todoistManualUpdates);
  }, 10000);
}

// ----------------------------- Main ---------------------------------//

const IDs = {
  todoistTaskIDs: [''],
  notionPageIDs: [''],
};

storeCurrentSyncedTasks().then(intervalStart);
