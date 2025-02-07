import { HandlerTools, Logger } from "@iote/cqrs";

import { Cursor } from "@app/model/convs-mgr/conversations/admin/system";

import { WebhookBlock } from "@app/model/convs-mgr/stories/blocks/messaging";
import { HttpMethodTypes } from "@app/model/convs-mgr/stories/blocks/main";
import { EndUser } from "@app/model/convs-mgr/conversations/chats";

import { DefaultOptionMessageService } from "../../next-block/block-type/default-block.service";
import { BlockDataService } from "../../data-services/blocks.service";
import { ConnectionsDataService } from "../../data-services/connections.service";
import { VariablesDataService } from "../../data-services/variables.service";
import { EndUserDataService } from "../../data-services/end-user.service";
import { MailMergeVariables } from "../../variable-injection/mail-merge-variables.service";

import { IProcessOperationBlock } from "../models/process-operation-block.interface";

import { HttpService } from "../../../utils/http-service/http.service";

/**
 * When an end user send a message to the bot, we need to know the type of block @see {StoryBlockTypes} we sent 
 *  so that we can process the response based on that block.
 * 
 * This service processes a location input from the user.
 * 
 */
export class WebhookBlockService extends DefaultOptionMessageService implements IProcessOperationBlock
{
	sideOperations: Promise<any>[] = [];
	tools: HandlerTools;
	blockDataService: BlockDataService;

	private httpService: HttpService;

	constructor(blockDataService: BlockDataService, connDataService: ConnectionsDataService, tools: HandlerTools)
	{
		super(blockDataService, connDataService, tools);
		this.tools = tools;
		this.blockDataService = blockDataService;

		this.httpService = new HttpService();
	}

	public async handleBlock(storyBlock: WebhookBlock, updatedCursor: Cursor, orgId: string, endUser: EndUser)
	{

		const varDataService = new VariablesDataService(this.tools, orgId, endUser.id);

		const allVariables =  varDataService.getAllVariables(endUser);

		const response = await this.makeRequest(storyBlock, orgId, allVariables);

		if(storyBlock.variablesToSave) {

			const unpackedResponse = this.unpackResponse(storyBlock ,response);

			// Save variable here
			// Traverse through the unpacked response keys and save each key and its value to variables collection
			await this.saveToDB(orgId, endUser, unpackedResponse);
		}

		const newCursor = await this.getNextBlock(null, updatedCursor, storyBlock, orgId, updatedCursor.position.storyId, endUser.id);

		const nextBlock = await this.blockDataService.getBlockById(newCursor.position.blockId, orgId, newCursor.position.storyId);

		return {
			storyBlock: nextBlock,
			newCursor
		};
	}
	
	/**
	 * This function is the one that makes the request to the webhook
	 */
	private async makeRequest(storyBlock: WebhookBlock, orgId: string, savedVariables: {[key:string]:any})
	{
		const variablesToPost = storyBlock.variablesToPost;

		const URL = await this.mergeVariables(storyBlock.httpUrl, orgId, savedVariables);

		// Write a function that creates an object from the variablesToPost and the saved variables
		const payload = this.createPayload(variablesToPost, savedVariables);

		switch (storyBlock.httpMethod) {
			case HttpMethodTypes.GET:
				return this.httpService.get(URL, this.tools);
			case HttpMethodTypes.POST:
				return this.httpService.post(URL, payload, this.tools);
			default:
				return this.httpService.post(URL, payload, this.tools);
		}
	}

	private unpackResponse(webhookBlock: WebhookBlock, response: any)
	{
		let unpackedResponse = {};
		// Loop through webhookBlock.variablesToSave and and create an object with t
		for(let i of webhookBlock.variablesToSave) {
			let value =   i.value.split('.').reduce((obj, key) => obj[key], response);

			unpackedResponse[i.name] = value;
		}

		return unpackedResponse;
	}

	private createPayload(variablesToPost: string[], savedVariables: any) {
		let result = {};

		variablesToPost.forEach((key, i) => {
				result[key] = savedVariables[key];
		});
		return result;
	}

	private async mergeVariables(url: string, orgId: string, variables: {[key:string]:any}){
		const mailMergeVariables = new MailMergeVariables(this.tools);

		return mailMergeVariables.merge(url, orgId, variables);

	}

	private saveToDB(orgId: string, endUser: EndUser, responseData: any) {
		const endUserService = new EndUserDataService(this.tools, orgId);

		endUser.variables = {
			...endUser.variables,
			...responseData
		}

		return endUserService.updateEndUser(endUser)
	}

}